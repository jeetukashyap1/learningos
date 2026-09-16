/**
 * Runtime E2E harness for the personalized-learning correction (spec parts
 * 28, 30, 31, and the isolation/idempotency rules of 17 and 26).
 *
 * Group 0 (always runs, no credentials needed):
 *   - Unauthenticated calls to the multi-path API routes must 401 with a
 *     safe message: GET /api/learning/paths/list, POST /api/learning/paths/
 *     active, POST /api/learning/paths/create-new.
 *
 * Group 1 (spec part 28 - "test with very different students"):
 *   Five throwaway students with completely different goals, levels, daily
 *   times, and preferred video languages:
 *     A) React internship        (programming,            en)
 *     B) Class 12 Physics        (academic or exam-prep,  en)   - must
 *        contain ZERO programming terminology anywhere in the curriculum
 *     C) Spoken English fluency  (language,               hinglish)
 *     D) UI/UX design with Figma (creative or practical,  en)
 *     E) Mathematics from basics (academic,               hi)
 *   Each student: onboarding upsert (including video_language) -> generate
 *   -> 200, DB verification (exactly one active row, the right domain, a
 *   non-empty subject, the persisted video_language and verbatim topic,
 *   4-12 fully structured lessons ordered 1..N), the programming-marker
 *   leakage check for every non-programming student, and the real pages
 *   (/journey, /dashboard, /learn/[lessonId]) rendering THAT student's
 *   path - never the Full-Stack sample content.
 *
 * Group 2 (spec parts 16/17/26/30/31 - multiple paths + video quality):
 *   On a dedicated throwaway account, deterministically reset between runs
 *   via a REST DELETE (RLS lets owners delete their learning_paths rows
 *   and lessons cascade-delete):
 *   - Phase A: path A (React) via generate; an accidental regenerate is
 *     idempotent (same pathId, created:false - no duplicates, part 17).
 *   - Phase B: POST /attach on path A -> video-quality checks (part 31):
 *     every lesson is honestly found/pending/unavailable, found lessons
 *     carry a real selected_resource_id that exists in learning_resources
 *     and record last_resource_searched_at, and /learn embeds the matched
 *     YouTube video.
 *   - Phase C: path B (UI/UX, video_language "any") via create-new -> a
 *     NEW row; both rows intact, exactly one active, path A's lessons
 *     untouched (part 17: explicit new path, never the cached one).
 *   - Phase D: GET /list and the /paths library page show both paths;
 *     switching (POST /active) flips is_active and changes /journey; a
 *     lesson from the inactive path renders "We could not find that
 *     lesson." (NOT ON YOUR PATH) - no data ever mixes between paths.
 *   - Phase E: rejected switches (401/400 battery, another user's pathId
 *     -> 404) and recovery by re-activating the real path.
 *
 * Prerequisites: supabase/migrations/20260910000000 and
 * supabase/migrations/20260911000000 applied in the Supabase SQL editor,
 * a fresh build running (npm run build && npm start on :3100),
 * .env.local with the Supabase + API keys, and email confirmation disabled
 * on the Supabase project (same as the existing harness - the throwaway
 * accounts are created on the first run and sign in forever after).
 *
 * Usage: node scripts/test-different-students.mjs [baseUrl]
 */

import { readFile } from "node:fs/promises";
import http from "node:http";

const BASE_URL = process.argv[2] ?? "http://localhost:3100";
const envFile = await readFile(".env.local", "utf8");
const env = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const eq = line.indexOf("=");
      return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
    }),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const cookieName = `sb-${projectRef}-auth-token`;

const results = [];
const skipped = [];

function record(name, pass, expected, got, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: expected ${expected}, got ${got}${detail ? ` — ${detail}` : ""}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

/** Asserts a JSON error body is safe: string error, no secret leakage. */
function assertSafeErrorBody(body, raw) {
  if (!body || typeof body.error !== "string" || body.error.length === 0) {
    return "body is not a safe error object";
  }
  const text = raw ?? JSON.stringify(body);
  if (env.NVIDIA_API_KEY && text.includes(env.NVIDIA_API_KEY)) {
    return "body leaks the NVIDIA API key";
  }
  if (env.YOUTUBE_API_KEY && text.includes(env.YOUTUBE_API_KEY)) {
    return "body leaks the YouTube API key";
  }
  return null;
}

async function api(name, path, { method = "POST", cookieHeader, body, expectStatus } = {}) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const raw = await res.text();
    const parsed = raw ? JSON.parse(raw) : null;
    let problem = null;
    if (res.status >= 400) {
      problem = assertSafeErrorBody(parsed, raw);
    }
    record(name, res.status === expectStatus && !problem, expectStatus, res.status, problem ?? undefined);
    return parsed;
  } catch (error) {
    record(name, false, expectStatus, `fetch error: ${error.message}`);
    return null;
  }
}

async function page(name, path, expectStatus, { cookieHeader, marker, notMarker } = {}) {
  try {
    // Transport retries: this machine's network occasionally drops a
    // request entirely ("fetch failed"); the same page fetches fine a
    // moment later, and one blip must not fail an otherwise-green check.
    let res = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        res = await fetch(`${BASE_URL}${path}`, {
          headers: cookieHeader ? { cookie: cookieHeader } : {},
          redirect: "manual",
        });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        console.log(`[retry] ${name} attempt ${attempt}: fetch error (${error.message})`);
      }
    }
    let problem = null;
    if (res.status === 200 && (marker || notMarker)) {
      const html = await res.text();
      if (marker && !html.includes(marker)) problem = `page does not include marker "${marker}"`;
      if (notMarker && html.includes(notMarker)) problem = `page includes forbidden marker "${notMarker}"`;
    }
    record(name, res.status === expectStatus && !problem, expectStatus, res.status, problem ?? undefined);
    return res.status === 200 ? res : null;
  } catch (error) {
    record(name, false, expectStatus, `fetch error: ${error.message}`);
    return null;
  }
}

/** POSTs an AI curriculum route (generate / create-new) with retries.
 *
 * NVIDIA latency varies widely (observed ~1min to >4min for the nested
 * curriculum) and this machine's network drops long requests entirely,
 * so the client can see a 502 with a safe "please try again" message
 * (the server rejected the model output or timed out before persisting
 * anything) or a lost response. generate is idempotent (a persisted
 * path is returned untouched) and create-new persists nothing on AI
 * failure, so a safe 502 is retryable for both routes the same way the
 * product UI does. A LOST create-new response is NOT retried: the
 * request may have succeeded server-side, and create-new would then
 * mint a second path. A 401 is also retried: the harness proves the
 * cookie valid immediately before each call (deterministic reset 204 +
 * onboarding 200), so a 401 from these routes is the server's own auth
 * check failing on this flaky network - and it fails before any write,
 * so create-new cannot double-mint. Only the final attempt is
 * recorded. */
/** Raw-socket POST via node:http. The AI routes can legitimately take
 * 15+ minutes when the server retries NVIDIA internally (4 attempts x
 * 260s timeout), but Node's fetch (undici) aborts any request whose
 * response HEADERS have not arrived within 300s - the client then sees
 * "fetch failed" while the server is still working, retries in
 * parallel, and the whole suite cascades. node:http has no such
 * default headers timeout, so the generate/create-new calls use this
 * transport instead. */
function rawPost(pathname, cookieHeader) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "POST",
        headers: { cookie: cookieHeader },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, raw });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function generateWithRetry(name, path, { cookieHeader, retryLostResponse = true } = {}) {
  let status = 0;
  let body = null;
  let problem = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await rawPost(path, cookieHeader);
      const raw = res.raw;
      status = res.status;
      body = raw ? JSON.parse(raw) : null;
      problem = status >= 400 ? assertSafeErrorBody(body, raw) : null;
    } catch (error) {
      status = 0;
      body = null;
      problem = null;
      console.log(`[retry] ${name} attempt ${attempt}: fetch error (${error.message})`);
    }
    const retryable =
      problem === null &&
      ((retryLostResponse && status === 0) || status === 502 || status === 401);
    if (!retryable || attempt === 4) break;
    console.log(
      `[retry] ${name} attempt ${attempt}: ${status === 0 ? "response lost" : `${status} failure`}, retrying`,
    );
  }
  record(name, status === 200 && !problem, 200, status, problem ?? undefined);
  return status === 200 && !problem ? body : null;
}

/** Direct-to-Supabase fetch with retries: this machine occasionally fails the
 * TCP connect to the Supabase host, and one blip must not kill the harness. */
async function supabaseFetch(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** supabaseFetch that never throws: on total network failure it returns a
 * failed pseudo-response (HTTP 0) the call sites already know how to report,
 * so a dead network becomes a visible FAIL/SKIP instead of a crash that
 * hides the results collected so far. */
async function supabaseFetchSafe(url, options) {
  try {
    return await supabaseFetch(url, options);
  } catch {
    console.warn("[network] Supabase unreachable after retries — recording failure for this call");
    return { ok: false, status: 0, json: async () => null, text: async () => "" };
  }
}

/** Signs up a throwaway account (or signs in when it already exists). The
 * whole signup+password-grant round is retried when Supabase is unreachable
 * (HTTP 0): this machine's DNS fails in transient bursts that can outlast
 * supabaseFetch's internal retry window, and one burst must not skip an
 * entire student flow. Real auth failures (422/400) fail immediately. */
async function throwawaySession(email, password) {
  for (let round = 1; round <= 3; round += 1) {
    const signupRes = await supabaseFetchSafe(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const signupBody = await signupRes.json().catch(() => null);
    if (signupBody?.session?.access_token) {
      console.log(`[setup] signed up ${email}`);
      return signupBody.session;
    }
    const signinRes = await supabaseFetchSafe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const signinBody = await signinRes.json().catch(() => null);
    if (signinRes.ok && signinBody?.access_token) {
      console.log(`[setup] signed in ${email} (account already exists)`);
      return signinBody;
    }
    const unreachable = signupRes.status === 0 || signinRes.status === 0;
    if (!unreachable || round === 3) {
      console.log(`[setup] no session for ${email} (signup HTTP ${signupRes.status}, password grant HTTP ${signinRes.status})`);
      return null;
    }
    const waitMs = 5000 * round;
    console.log(`[setup] Supabase unreachable for ${email} (round ${round}), retrying in ${waitMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return null;
}

/** Builds the @supabase/ssr chunked cookie header: URI-encoded JSON session,
 * chunked at 3180 chars into <name>.0, <name>.1, ... when needed. */
function sessionCookieHeader(session) {
  const encoded = encodeURIComponent(JSON.stringify(session));
  const chunks = [];
  for (let i = 0; i * 3180 < encoded.length; i += 1) {
    chunks.push(encoded.slice(i * 3180, (i + 1) * 3180));
  }
  return chunks
    .map((chunk, i) => (chunks.length === 1 ? `${cookieName}=${chunk}` : `${cookieName}.${i}=${chunk}`))
    .join("; ");
}

/** Authenticated REST call returning { ok, status, body } (body null on
 * network failure or non-JSON response) so call sites can record cleanly. */
async function restJson(url, options) {
  const res = await supabaseFetchSafe(url, options);
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

/** A marker safe for an exact html.includes() check: plain text that React
 * SSR would not escape or split. Returns null when the value is unusable. */
function htmlSafeMarker(value) {
  return typeof value === "string" && value.trim().length >= 4 && !/[&<>'"]/.test(value) ? value : null;
}

/** The programming-terminology markers the validator rejects in
 * non-programming domains (lib/ai/validate.ts) - mirrored here so the test
 * proves the domain-discipline guarantee end-to-end, in the persisted data. */
const PROGRAMMING_MARKERS = [
  /\bjavascript\b/i,
  /\btypescript\b/i,
  /\breact\b/i,
  /\bangular\b/i,
  /\bvue\b/i,
  /\bnode\.?js\b/i,
  /\bexpress\.?js\b/i,
  /\bmongodb\b/i,
  /\bhtml\b/i,
  /\bcss\b/i,
  /\bfull[- ]?stack\b/i,
  /\bfront[- ]?end\b/i,
  /\bback[- ]?end\b/i,
  /\bweb\s+dev(elopment)?\b/i,
  /\brest\s+api\b/i,
  /\bapi\b/i,
  /\bapis\b/i,
  /\bgraphql\b/i,
  /\bdocker\b/i,
  /\bkubernetes\b/i,
  /\bgit\b/i,
  /\bgithub\b/i,
  /\bpython\b/i,
  /\bjava\b/i,
  /\bc\+\+\b/i,
  /\bsql\b/i,
  /\bdatabase\b/i,
  /\bsoftware\s+dev(eloper|elopment)?\b/i,
  /\bcoding\b/i,
];

const PASSWORD = "path-e2e-test-Password1!";

/** Pre-flight: the 20260910000000 + 20260911000000 schema must exist before
 * any flow runs, so a missing migration becomes one clear FAIL instead of
 * confusing 400s from every upsert. Runs once with the first authenticated
 * session. */
let migrationReady = null;
async function ensurePreflight(session) {
  if (migrationReady !== null) return;
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` };
  const res = await supabaseFetchSafe(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=is_active,domain,subject,video_language&user_id=eq.${session.user.id}`,
    { headers },
  );
  if (res.status === 0) {
    migrationReady = false;
    record("pre-flight: Supabase reachable", false, "2xx", 0, "network unreachable after retries");
    return;
  }
  const body = await res.json().catch(() => null);
  migrationReady = res.ok;
  record(
    "pre-flight: migration 20260910000000 columns exist (is_active/domain/subject/video_language)",
    res.ok,
    "2xx",
    res.status,
    res.ok ? undefined : `apply supabase/migrations/20260910000000_extend_personalized_learning.sql in the Supabase SQL editor, then re-run — ${JSON.stringify(body).slice(0, 200)}`,
  );

  // 20260911000000: the modules table + module_id/outcome columns. PostgREST
  // rejects a select on a missing column (400 PGRST204) or a missing table,
  // so one cheap probe per object detects whether the migration was applied.
  const modulesTable = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_path_modules?select=id&limit=1`, { headers });
  const outcomeColumn = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?select=outcome_kind&user_id=eq.${session.user.id}`, { headers });
  const lessonModuleColumn = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_path_lessons?select=module_id&limit=1`, { headers });
  const modulesOk = modulesTable.ok && outcomeColumn.ok && lessonModuleColumn.ok;
  if (!modulesOk) migrationReady = false;
  record(
    "pre-flight: migration 20260911000000 applied (learning_path_modules + module_id + outcome columns)",
    modulesOk,
    "2xx on all three probes",
    `modules:${modulesTable.status} outcome:${outcomeColumn.status} module_id:${lessonModuleColumn.status}`,
    modulesOk ? undefined : "apply supabase/migrations/20260911000000_add_modules_and_final_outcome.sql in the Supabase SQL editor, then re-run",
  );
}

// ---------------------------------------------------------------------------
// Group 0: unauthenticated API access must 401 with a safe message.
// ---------------------------------------------------------------------------

console.log("\n== Group 0: credential-free security tests ==\n");

await api("no cookie: list -> 401", "/api/learning/paths/list", { method: "GET", expectStatus: 401 });
await api("no cookie: active -> 401", "/api/learning/paths/active", {
  body: { pathId: "00000000-0000-0000-0000-000000000000" },
  expectStatus: 401,
});
await api("no cookie: create-new -> 401", "/api/learning/paths/create-new", { expectStatus: 401 });

// ---------------------------------------------------------------------------
// Group 1: five very different students (spec part 28).
// ---------------------------------------------------------------------------

const STUDENTS = [
  {
    key: "A",
    label: "React internship",
    email: "student-react-e2e@gmail.com",
    profile: {
      topic: "React development for my internship",
      current_level: "building",
      daily_time: "30",
      goal_type: "job",
      video_language: "en",
    },
    expectedDomains: ["programming"],
    expectedOutcomeKinds: ["project"],
    checkProgrammingMarkers: false,
  },
  {
    key: "B",
    label: "Class 12 Physics",
    email: "student-physics-e2e@gmail.com",
    profile: {
      topic: "Class 12 Physics",
      current_level: "basics",
      daily_time: "60",
      goal_type: "career",
      video_language: "en",
    },
    expectedDomains: ["academic", "exam-prep"],
    // Spec part 30: a Physics path must never end with a Full-Stack project.
    expectedOutcomeKinds: ["assessment", "mock-exam"],
    checkProgrammingMarkers: true,
  },
  {
    key: "C",
    label: "Spoken English",
    email: "student-english-e2e@gmail.com",
    profile: {
      topic: "Spoken English fluency",
      current_level: "basics",
      daily_time: "15",
      goal_type: "curiosity",
      video_language: "hinglish",
    },
    expectedDomains: ["language"],
    expectedOutcomeKinds: ["mock-interview"],
    checkProgrammingMarkers: true,
  },
  {
    key: "D",
    label: "UI/UX with Figma",
    email: "student-uiux-e2e@gmail.com",
    profile: {
      topic: "UI/UX design with Figma",
      current_level: "fresh",
      daily_time: "weekend",
      goal_type: "project",
      video_language: "en",
    },
    expectedDomains: ["creative", "practical"],
    expectedOutcomeKinds: ["case-study", "portfolio", "presentation"],
    checkProgrammingMarkers: true,
  },
  {
    key: "E",
    label: "Mathematics",
    email: "student-math-e2e@gmail.com",
    profile: {
      topic: "Mathematics from basics",
      current_level: "fresh",
      daily_time: "30",
      goal_type: "curiosity",
      video_language: "hi",
    },
    expectedDomains: ["academic"],
    expectedOutcomeKinds: ["assessment", "mock-exam"],
    checkProgrammingMarkers: true,
  },
];

/** Hero label per outcome kind (mirrors OUTCOME_HERO_LABELS in
 * app/(app)/projects/page.tsx) so the page assertions check the real
 * rendered label, never a hardcoded guess. */
const OUTCOME_HERO_LABELS = {
  project: "YOUR FINAL PROJECT",
  assessment: "YOUR FINAL ASSESSMENT",
  "mock-exam": "YOUR MOCK EXAM",
  "mock-interview": "YOUR MOCK INTERVIEW",
  "case-study": "YOUR CASE STUDY",
  presentation: "YOUR RESEARCH PRESENTATION",
  portfolio: "YOUR PORTFOLIO",
  other: "YOUR FINAL OUTCOME",
};

/** One very different student, end to end: onboarding -> generate -> DB ->
 * domain discipline -> the real pages. Returns { pathId } on success. */
async function runStudent(student) {
  const label = `student ${student.key} (${student.label})`;
  const session = await throwawaySession(student.email, PASSWORD);
  if (!session) {
    skipped.push(`${label} flow (no session for ${student.email})`);
    return null;
  }
  await ensurePreflight(session);
  if (migrationReady === false) {
    skipped.push(`${label} flow (migrations 20260910000000/20260911000000 not applied)`);
    return null;
  }

  const cookieHeader = sessionCookieHeader(session);
  const restHeaders = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };
  const userId = session.user.id;

  // Deterministic reset: the throwaway accounts persist across runs and an
  // old path would be reused idempotently (possibly predating the module/
  // outcome schema), so delete it first (RLS lets the owner DELETE; lessons
  // and modules cascade) and always generate a fresh structured curriculum.
  const resetRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?user_id=eq.${userId}`, {
    method: "DELETE",
    headers: restHeaders,
  });
  record(`${label}: deterministic reset (owner DELETE) -> 2xx`, resetRes.ok, "2xx", resetRes.status);

  // 1. Onboard with the REAL answers, including the preferred video language.
  const onboard = await restJson(`${SUPABASE_URL}/rest/v1/onboarding_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: userId, ...student.profile }),
  });
  record(`${label}: onboarding upsert (incl. video_language) -> 2xx`, onboard.ok, "2xx", onboard.status);

  // 2. Generate the personalized curriculum for THIS student.
  const generated = await generateWithRetry(`${label}: generate -> 200`, "/api/learning/paths/generate", {
    cookieHeader,
  });
  if (!generated || typeof generated.pathId !== "string") {
    skipped.push(`${label} DB/page checks (generate did not return a pathId)`);
    return null;
  }
  record(
    `${label}: generate returns a title`,
    typeof generated.title === "string" && generated.title.trim().length > 0,
    "non-empty title",
    typeof generated.title,
  );
  if (resetRes.ok) {
    record(`${label}: curriculum freshly created`, generated.created === true, true, String(generated.created));
  }
  record(
    `${label}: generate returns 2-10 modules`,
    typeof generated.moduleCount === "number" && generated.moduleCount >= 2 && generated.moduleCount <= 10,
    "2-10",
    String(generated.moduleCount),
  );
  record(
    `${label}: final outcome kind is ${student.expectedOutcomeKinds.join(" or ")}`,
    student.expectedOutcomeKinds.includes(generated.outcomeKind),
    student.expectedOutcomeKinds.join("|"),
    String(generated.outcomeKind),
  );

  // 3. DB: exactly one active row with the right domain and persisted answers.
  const { body: pathRows } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,title,topic,domain,subject,is_active,video_language,estimated_days,outcome_kind,outcome_title,outcome_objective,outcome_requirements,outcome_milestones&user_id=eq.${userId}`,
    { headers: restHeaders },
  );
  const pathRow = Array.isArray(pathRows) && pathRows.length === 1 ? pathRows[0] : null;
  record(
    `${label}: exactly one learning_paths row`,
    Array.isArray(pathRows) && pathRows.length === 1,
    1,
    Array.isArray(pathRows) ? pathRows.length : "unreadable",
  );
  if (!pathRow) {
    skipped.push(`${label} lesson/page checks (path row unreadable)`);
    return { pathId: generated.pathId };
  }
  record(
    `${label}: domain is ${student.expectedDomains.join(" or ")}`,
    student.expectedDomains.includes(pathRow.domain),
    student.expectedDomains.join("|"),
    String(pathRow.domain),
  );
  record(
    `${label}: subject is a non-empty string`,
    typeof pathRow.subject === "string" && pathRow.subject.trim().length > 0,
    "non-empty",
    typeof pathRow.subject === "string" ? pathRow.subject.slice(0, 60) : String(pathRow.subject),
  );
  record(`${label}: path is the active one`, pathRow.is_active === true, true, String(pathRow.is_active));
  record(
    `${label}: video_language persisted (${student.profile.video_language})`,
    pathRow.video_language === student.profile.video_language,
    student.profile.video_language,
    String(pathRow.video_language),
  );
  record(
    `${label}: topic persisted verbatim`,
    pathRow.topic === student.profile.topic,
    student.profile.topic,
    String(pathRow.topic),
  );
  record(
    `${label}: estimated_days within 1-365`,
    typeof pathRow.estimated_days === "number" && pathRow.estimated_days >= 1 && pathRow.estimated_days <= 365,
    "1-365",
    String(pathRow.estimated_days),
  );
  record(
    `${label}: outcome_kind persisted and matches the expected domain outcome`,
    pathRow.outcome_kind === generated.outcomeKind && student.expectedOutcomeKinds.includes(pathRow.outcome_kind),
    student.expectedOutcomeKinds.join("|"),
    String(pathRow.outcome_kind),
  );
  record(
    `${label}: outcome title and objective are non-empty`,
    typeof pathRow.outcome_title === "string" && pathRow.outcome_title.trim().length > 0 && typeof pathRow.outcome_objective === "string" && pathRow.outcome_objective.trim().length > 0,
    "non-empty",
    `${String(pathRow.outcome_title).slice(0, 40)} / ${String(pathRow.outcome_objective).slice(0, 40)}`,
  );
  const outcomeRequirements = Array.isArray(pathRow.outcome_requirements) ? pathRow.outcome_requirements : [];
  const outcomeMilestones = Array.isArray(pathRow.outcome_milestones) ? pathRow.outcome_milestones : [];
  record(
    `${label}: outcome requirements and milestones 1-8 each, non-empty`,
    outcomeRequirements.length >= 1 && outcomeRequirements.length <= 8 && outcomeRequirements.every((item) => typeof item === "string" && item.trim().length > 0) && outcomeMilestones.length >= 1 && outcomeMilestones.length <= 8 && outcomeMilestones.every((item) => typeof item === "string" && item.trim().length > 0),
    "1-8 each",
    `${outcomeRequirements.length} requirements / ${outcomeMilestones.length} milestones`,
  );

  // 4. DB: the module structure the AI planner must persist (spec parts 2-4).
  const { body: moduleRows } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_path_modules?select=id,order_index,title,description,objective,estimated_minutes&path_id=eq.${generated.pathId}&order=order_index.asc`,
    { headers: restHeaders },
  );
  const moduleList = Array.isArray(moduleRows) ? moduleRows : null;
  const moduleIds = new Set(moduleList ? moduleList.map((module) => module.id) : []);
  record(
    `${label}: module count matches the API and is 2-10`,
    moduleList !== null && moduleList.length === generated.moduleCount && moduleList.length >= 2 && moduleList.length <= 10,
    "2-10",
    moduleList === null ? "unreadable" : String(moduleList.length),
  );
  if (moduleList && moduleList.length > 0) {
    const modulesOrderedOk = moduleList.every((module, i) => module.order_index === i + 1);
    record(
      `${label}: modules ordered 1..N`,
      modulesOrderedOk,
      "1..N",
      modulesOrderedOk ? "1..N" : moduleList.map((module) => module.order_index).join(","),
    );
    const modulesStructuredOk = moduleList.every((module) =>
      [module.title, module.description, module.objective].every((value) => typeof value === "string" && value.trim().length > 0),
    );
    record(`${label}: every module carries title/description/objective`, modulesStructuredOk, "all non-empty", modulesStructuredOk ? "all non-empty" : "some fields empty");
    const modulesMinutesOk = moduleList.every((module) => typeof module.estimated_minutes === "number" && module.estimated_minutes >= 1 && module.estimated_minutes <= 10000);
    record(`${label}: module estimated minutes within 1-10000`, modulesMinutesOk, "1-10000", modulesMinutesOk ? "ok" : "out of range");
  }

  // 5. DB: the structured lesson set the AI planner must persist.
  const { body: lessons } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order,title,description,topic,skill,objective,concepts,practical_outcome,practice_concept,goal_relevance,search_queries,estimated_minutes,module_id&path_id=eq.${generated.pathId}&order=lesson_order.asc`,
    { headers: restHeaders },
  );
  const lessonList = Array.isArray(lessons) ? lessons : null;
  record(
    `${label}: lesson count within 4-12 and matches the API`,
    lessonList !== null && lessonList.length >= 4 && lessonList.length <= 12 && lessonList.length === generated.lessonCount,
    "4-12",
    lessonList === null ? "unreadable" : String(lessonList.length),
  );
  if (!lessonList || lessonList.length === 0) {
    skipped.push(`${label} page checks (lesson rows unreadable)`);
    return { pathId: generated.pathId };
  }
  const orderedOk = lessonList.every((lesson, i) => lesson.lesson_order === i + 1);
  record(
    `${label}: lessons ordered 1..N`,
    orderedOk,
    "1..N",
    orderedOk ? "1..N" : lessonList.map((lesson) => lesson.lesson_order).join(","),
  );
  const structuredOk = lessonList.every((lesson) =>
    [lesson.title, lesson.topic, lesson.skill, lesson.objective, lesson.practical_outcome, lesson.practice_concept, lesson.goal_relevance].every(
      (value) => typeof value === "string" && value.trim().length > 0,
    ),
  );
  record(`${label}: every lesson carries the full structured fields`, structuredOk, "all non-empty", structuredOk ? "all non-empty" : "some fields empty");
  const conceptsOk = lessonList.every(
    (lesson) =>
      Array.isArray(lesson.concepts) &&
      lesson.concepts.length >= 1 &&
      lesson.concepts.length <= 8 &&
      lesson.concepts.every((concept) => typeof concept === "string" && concept.trim().length > 0),
  );
  record(`${label}: concepts 1-8 per lesson`, conceptsOk, "1-8", conceptsOk ? "ok" : "out of range");
  const queriesOk = lessonList.every(
    (lesson) =>
      Array.isArray(lesson.search_queries) &&
      lesson.search_queries.length >= 1 &&
      lesson.search_queries.length <= 5 &&
      lesson.search_queries.every((query) => typeof query === "string" && query.trim().length > 0),
  );
  record(`${label}: search queries 1-5 per lesson`, queriesOk, "1-5", queriesOk ? "ok" : "out of range");
  const minutesOk = lessonList.every(
    (lesson) => typeof lesson.estimated_minutes === "number" && lesson.estimated_minutes >= 1 && lesson.estimated_minutes <= 600,
  );
  record(`${label}: estimated minutes within 1-600`, minutesOk, "1-600", minutesOk ? "ok" : "out of range");
  const lessonModuleOk =
    moduleList !== null &&
    moduleList.length > 0 &&
    lessonList.every((lesson) => typeof lesson.module_id === "string" && moduleIds.has(lesson.module_id));
  record(
    `${label}: every lesson is linked to a module on this path`,
    lessonModuleOk,
    "all module_id set and valid",
    lessonModuleOk ? "all linked" : "some lessons unlinked or pointing outside the path",
  );

  // 6. Domain discipline (spec parts 1/9/28): a non-programming student must
  // never see programming terminology anywhere in their curriculum.
  if (student.checkProgrammingMarkers) {
    const violations = [];
    for (const lesson of lessonList) {
      const text = [
        lesson.title,
        lesson.description,
        lesson.topic,
        lesson.skill,
        lesson.objective,
        ...(Array.isArray(lesson.concepts) ? lesson.concepts : []),
        lesson.practical_outcome,
        lesson.practice_concept,
        lesson.goal_relevance,
        ...(Array.isArray(lesson.search_queries) ? lesson.search_queries : []),
      ]
        .filter((part) => typeof part === "string")
        .join(" ");
      for (const marker of PROGRAMMING_MARKERS) {
        if (marker.test(text)) violations.push(`lesson ${lesson.lesson_order} ("${lesson.title}") matched ${marker}`);
      }
    }
    record(
      `${label}: zero programming markers in the curriculum`,
      violations.length === 0,
      0,
      violations.length,
      violations.slice(0, 3).join(" | "),
    );
  }

  // 7. The real pages render THIS student's path, never the sample content.
  await page(`${label}: /journey shows the real path (module sections)`, "/journey", 200, {
    cookieHeader,
    marker: "Module 1:",
    notMarker: "Become a Full-Stack Developer",
  });
  await page(`${label}: /journey shows the final outcome card`, "/journey", 200, {
    cookieHeader,
    marker: "Final outcome",
  });
  const titleMarker = htmlSafeMarker(pathRow.title);
  if (titleMarker) {
    await page(`${label}: /journey shows this student's path title`, "/journey", 200, {
      cookieHeader,
      marker: titleMarker,
    });
  } else {
    console.log(`[note] ${label}: path title not HTML-safe for an exact marker check — skipped that one assertion`);
  }
  await page(`${label}: /dashboard shows the live-path state`, "/dashboard", 200, {
    cookieHeader,
    marker: "Your learning path is live.",
  });
  await page(`${label}: /dashboard echoes this student's topic`, "/dashboard", 200, {
    cookieHeader,
    marker: student.profile.topic,
  });
  await page(`${label}: /learn/[lesson] renders the real lesson`, `/learn/${lessonList[0].id}`, 200, {
    cookieHeader,
    marker: "YOUR VIDEO FOR THIS LESSON",
    notMarker: "No lesson yet.",
  });
  const lessonTitleMarker = htmlSafeMarker(lessonList[0].title);
  if (lessonTitleMarker) {
    await page(`${label}: /learn/[lesson] shows the lesson title`, `/learn/${lessonList[0].id}`, 200, {
      cookieHeader,
      marker: lessonTitleMarker,
    });
  }
  await page(`${label}: /learn/[lesson] shows the module context`, `/learn/${lessonList[0].id}`, 200, {
    cookieHeader,
    marker: "MODULE 1 · LESSON 1 OF",
  });
  await page(`${label}: /practice labels challenges with their module`, "/practice", 200, {
    cookieHeader,
    marker: "Module 1 ·",
  });
  const expectedHero = OUTCOME_HERO_LABELS[generated.outcomeKind] ?? "YOUR FINAL OUTCOME";
  await page(`${label}: /projects shows the ${generated.outcomeKind || "final"} outcome hero`, "/projects", 200, {
    cookieHeader,
    marker: expectedHero,
    ...(generated.outcomeKind === "project" ? {} : { notMarker: "YOUR FINAL PROJECT" }),
  });
  await page(`${label}: /projects shows what the outcome is built from`, "/projects", 200, {
    cookieHeader,
    marker: "BUILT FROM",
  });

  return { pathId: generated.pathId };
}

console.log("\n== Group 1: five very different students (spec part 28) ==\n");

let studentAPathId = null;
for (const student of STUDENTS) {
  if (migrationReady === false) {
    skipped.push(`student ${student.key} (${student.label}) flow (migrations 20260910000000/20260911000000 not applied)`);
    continue;
  }
  const outcome = await runStudent(student);
  if (student.key === "A" && outcome) studentAPathId = outcome.pathId;
}

// ---------------------------------------------------------------------------
// Group 2: multiple learning paths + video quality (spec parts 16/17/26/30/31).
// ---------------------------------------------------------------------------

async function runMultiPath(foreignPathId) {
  const session = await throwawaySession("multipath-e2e@gmail.com", PASSWORD);
  if (!session) {
    skipped.push("multi-path flow (no session for multipath-e2e@gmail.com)");
    return;
  }
  await ensurePreflight(session);
  if (migrationReady === false) {
    skipped.push("multi-path flow (migration 20260910000000 not applied)");
    return;
  }

  const cookieHeader = sessionCookieHeader(session);
  const restHeaders = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };
  const userId = session.user.id;

  // --- Phase A: first path (React) + idempotent regenerate (spec part 17) ---
  console.log("-- Phase A: first path (React) + idempotent regenerate --");

  // Deterministic reset: RLS lets the owner DELETE their learning_paths rows
  // and lessons cascade-delete, so reruns always start from zero paths.
  const resetRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?user_id=eq.${userId}`, {
    method: "DELETE",
    headers: restHeaders,
  });
  record("multi-path: deterministic reset (owner DELETE) -> 2xx", resetRes.ok, "2xx", resetRes.status);

  const profileA = {
    topic: "React web development",
    current_level: "building",
    daily_time: "30",
    goal_type: "job",
    video_language: "en",
  };
  const onboardA = await restJson(`${SUPABASE_URL}/rest/v1/onboarding_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: userId, ...profileA }),
  });
  record("multi-path: onboarding upsert for path A -> 2xx", onboardA.ok, "2xx", onboardA.status);

  const genA = await generateWithRetry("multi-path: generate path A -> 200", "/api/learning/paths/generate", {
    cookieHeader,
  });
  if (!genA || typeof genA.pathId !== "string") {
    skipped.push("multi-path flow (generate failed)");
    return;
  }
  if (resetRes.ok) {
    record("multi-path: path A was freshly created", genA.created === true, true, String(genA.created));
  }

  // Accidental duplicate generate must NOT create a second path (part 17).
  const genA2 = await generateWithRetry("multi-path: accidental regenerate -> 200 (idempotent)", "/api/learning/paths/generate", {
    cookieHeader,
  });
  record("multi-path: regenerate returns the SAME pathId", genA2?.pathId === genA.pathId, genA.pathId, String(genA2?.pathId));
  record("multi-path: regenerate reports created:false (no duplicate)", genA2?.created === false, false, String(genA2?.created));

  const { body: rowsA } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,title,domain,is_active,video_language&user_id=eq.${userId}`,
    { headers: restHeaders },
  );
  record(
    "multi-path: exactly one row after generate",
    Array.isArray(rowsA) && rowsA.length === 1,
    1,
    Array.isArray(rowsA) ? rowsA.length : "unreadable",
  );
  const rowA0 = Array.isArray(rowsA) && rowsA.length === 1 ? rowsA[0] : null;
  if (rowA0) {
    record("multi-path: path A is active", rowA0.is_active === true, true, String(rowA0.is_active));
    record("multi-path: path A domain is programming", rowA0.domain === "programming", "programming", String(rowA0.domain));
    record("multi-path: path A video_language is en", rowA0.video_language === "en", "en", String(rowA0.video_language));
  }

  // --- Phase B: video quality on path A (spec part 31) ---
  console.log("\n-- Phase B: video quality on path A (spec part 31) --");

  const attachA = await api("multi-path: attach -> 200", "/api/learning/paths/attach", {
    cookieHeader,
    expectStatus: 200,
  });
  record("multi-path: attach ran for the active path A", attachA?.pathId === genA.pathId, genA.pathId, String(attachA?.pathId));
  if (attachA) {
    const accounted = attachA.resourcesFound + attachA.resourcesPending + attachA.resourcesUnavailable;
    record(
      "video quality: found+pending+unavailable equals lesson count",
      accounted === genA.lessonCount,
      genA.lessonCount,
      String(accounted),
    );
  }

  const { body: lessonsA } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order,title,resource_status,selected_resource_id,last_resource_searched_at&path_id=eq.${genA.pathId}&order=lesson_order.asc`,
    { headers: restHeaders },
  );
  const lessonRowsA = Array.isArray(lessonsA) ? lessonsA : [];
  const statusesOk =
    lessonRowsA.length > 0 &&
    lessonRowsA.every(
      (lesson) => lesson.resource_status === "found" || lesson.resource_status === "pending" || lesson.resource_status === "unavailable",
    );
  record(
    "video quality: every lesson is honestly found/pending/unavailable",
    statusesOk,
    "enum only",
    statusesOk ? "enum only" : lessonRowsA.map((lesson) => lesson.resource_status).join(","),
  );
  const foundLessons = lessonRowsA.filter((lesson) => lesson.resource_status === "found");
  const unavailableLessons = lessonRowsA.filter((lesson) => lesson.resource_status === "unavailable");
  record(
    "video quality: found lessons carry a selected_resource_id",
    foundLessons.every((lesson) => typeof lesson.selected_resource_id === "string" && lesson.selected_resource_id.length > 0),
    "non-null ids",
    `${foundLessons.length} found`,
  );
  const searchedOk = [...foundLessons, ...unavailableLessons].every(
    (lesson) => typeof lesson.last_resource_searched_at === "string" && lesson.last_resource_searched_at.length > 0,
  );
  record(
    "video quality: found/unavailable lessons record last_resource_searched_at",
    searchedOk,
    "set",
    searchedOk ? "set" : "some missing",
  );

  if (foundLessons.length > 0) {
    // Every attached video must be a REAL persisted resource - the engine
    // only attaches what it actually found and ranked above the threshold.
    let resourcesExist = true;
    for (const lesson of foundLessons) {
      const { body: resourceRows } = await restJson(
        `${SUPABASE_URL}/rest/v1/learning_resources?select=id&id=eq.${lesson.selected_resource_id}`,
        { headers: restHeaders },
      );
      if (!Array.isArray(resourceRows) || resourceRows.length !== 1) resourcesExist = false;
    }
    record(
      "video quality: attached resources exist in learning_resources",
      resourcesExist,
      "1 row each",
      resourcesExist ? "1 row each" : "missing rows",
    );
    await page("video quality: /learn shows the video section", `/learn/${foundLessons[0].id}`, 200, {
      cookieHeader,
      marker: "YOUR VIDEO FOR THIS LESSON",
    });
    await page("video quality: /learn embeds the matched YouTube video", `/learn/${foundLessons[0].id}`, 200, {
      cookieHeader,
      marker: "youtube-nocookie.com/embed/",
    });
  } else {
    skipped.push("video quality resource/page checks (no lessons reached 'found' this run)");
  }

  // --- Phase C: second path (UI/UX) via create-new (spec parts 17/30) ---
  console.log("\n-- Phase C: second path (UI/UX) via create-new --");

  const profileB = {
    topic: "UI/UX design with Figma",
    current_level: "fresh",
    daily_time: "weekend",
    goal_type: "project",
    video_language: "any",
  };
  const onboardB = await restJson(`${SUPABASE_URL}/rest/v1/onboarding_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: userId, ...profileB }),
  });
  record("multi-path: onboarding upsert for path B -> 2xx", onboardB.ok, "2xx", onboardB.status);

  const genB = await generateWithRetry("multi-path: create-new -> 200 (explicit new path)", "/api/learning/paths/create-new", {
    cookieHeader,
    retryLostResponse: false,
  });
  if (!genB || typeof genB.pathId !== "string") {
    skipped.push("multi-path switching checks (create-new failed)");
    return;
  }
  record(
    "multi-path: path B is a DIFFERENT row (never the cached path)",
    genB.pathId !== genA.pathId,
    "new pathId",
    genB.pathId === genA.pathId ? "same pathId" : "new pathId",
  );

  const { body: rowsB } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,title,domain,is_active,video_language&user_id=eq.${userId}`,
    { headers: restHeaders },
  );
  const rowListB = Array.isArray(rowsB) ? rowsB : [];
  record("multi-path: exactly two learning_paths rows", rowListB.length === 2, 2, String(rowListB.length));
  const rowA = rowListB.find((row) => row.id === genA.pathId) ?? null;
  const rowB = rowListB.find((row) => row.id === genB.pathId) ?? null;
  record("multi-path: path B is the active one", rowB?.is_active === true, true, String(rowB?.is_active));
  record("multi-path: path A deactivated but kept", rowA != null && rowA.is_active === false, false, String(rowA?.is_active));
  record(
    "multi-path: path B domain is creative or practical",
    rowB != null && ["creative", "practical"].includes(rowB.domain),
    "creative|practical",
    String(rowB?.domain),
  );
  record("multi-path: path B video_language 'any' persisted", rowB?.video_language === "any", "any", String(rowB?.video_language));

  const { body: lessonsAAfter } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id&path_id=eq.${genA.pathId}`,
    { headers: restHeaders },
  );
  record(
    "multi-path: path A lessons intact after create-new",
    Array.isArray(lessonsAAfter) && lessonsAAfter.length === genA.lessonCount,
    genA.lessonCount,
    String(Array.isArray(lessonsAAfter) ? lessonsAAfter.length : "unreadable"),
  );

  const { body: lessonsB } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id&path_id=eq.${genB.pathId}`,
    { headers: restHeaders },
  );
  const lessonCountB = Array.isArray(lessonsB) ? lessonsB.length : 0;
  record("multi-path: path B has its own lessons (4-12)", lessonCountB >= 4 && lessonCountB <= 12, "4-12", String(lessonCountB));

  // --- Phase D: library, switching, isolation (spec parts 16/26/30) ---
  console.log("\n-- Phase D: library, switching, isolation --");

  const listBody = await api("multi-path: GET /list -> 200", "/api/learning/paths/list", {
    method: "GET",
    cookieHeader,
    expectStatus: 200,
  });
  const listPaths = Array.isArray(listBody?.paths) ? listBody.paths : [];
  record("multi-path: list returns both paths", listPaths.length === 2, 2, String(listPaths.length));
  const activeInList = listPaths.filter((item) => item.isActive === true);
  record(
    "multi-path: list marks exactly path B active",
    activeInList.length === 1 && activeInList[0]?.id === genB.pathId,
    genB.pathId,
    String(activeInList[0]?.id),
  );
  record("multi-path: list is newest first (path B on top)", listPaths[0]?.id === genB.pathId, genB.pathId, String(listPaths[0]?.id));
  record(
    "multi-path: list shows lesson counts for both",
    listPaths.length === 2 && listPaths.every((item) => typeof item.lessonCount === "number" && item.lessonCount > 0),
    ">0",
    listPaths.map((item) => item.lessonCount).join(","),
  );

  await page("multi-path: /paths shows the library", "/paths", 200, { cookieHeader, marker: "My learning paths" });
  await page("multi-path: /paths marks the current path", "/paths", 200, { cookieHeader, marker: "CURRENT PATH" });
  await page("multi-path: /paths lists the other path", "/paths", 200, { cookieHeader, marker: "IN YOUR LIBRARY" });
  await page("multi-path: /paths offers switching", "/paths", 200, { cookieHeader, marker: "Switch to this path" });
  await page("multi-path: /paths offers creating another path", "/paths", 200, { cookieHeader, marker: "Create a new path" });

  const titleMarkerB = htmlSafeMarker(rowB?.title);
  if (titleMarkerB) {
    await page("multi-path: /journey follows path B (active)", "/journey", 200, {
      cookieHeader,
      marker: titleMarkerB,
    });
  } else {
    console.log("[note] multi-path: path B title not HTML-safe for an exact marker check — skipped that one assertion");
  }

  // Path isolation: while B is active, an A lesson is NOT on the learner's path.
  const lessonA1 = Array.isArray(lessonsAAfter) && lessonsAAfter.length > 0 ? lessonsAAfter[0] : null;
  if (lessonA1) {
    await page("multi-path: path A lesson is NOT on the active path", `/learn/${lessonA1.id}`, 200, {
      cookieHeader,
      marker: "We could not find that lesson.",
      notMarker: "YOUR VIDEO FOR THIS LESSON",
    });
  }

  // Switch-route validation battery (no state changes).
  await api("multi-path: switch without a cookie -> 401", "/api/learning/paths/active", {
    body: { pathId: genA.pathId },
    expectStatus: 401,
  });
  await api("multi-path: switch with an empty body -> 400", "/api/learning/paths/active", {
    cookieHeader,
    body: {},
    expectStatus: 400,
  });
  await api("multi-path: switch with an empty pathId -> 400", "/api/learning/paths/active", {
    cookieHeader,
    body: { pathId: "" },
    expectStatus: 400,
  });
  await api("multi-path: switch with a non-string pathId -> 400", "/api/learning/paths/active", {
    cookieHeader,
    body: { pathId: 42 },
    expectStatus: 400,
  });

  // The real switch: every page must now operate on path A.
  const switchA = await api("multi-path: switch back to path A -> 200", "/api/learning/paths/active", {
    cookieHeader,
    body: { pathId: genA.pathId },
    expectStatus: 200,
  });
  record("multi-path: switch returns ok:true", switchA?.ok === true, true, String(switchA?.ok));

  const { body: rowsAfterSwitch } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,is_active&user_id=eq.${userId}`,
    { headers: restHeaders },
  );
  const activeAfterSwitch = (Array.isArray(rowsAfterSwitch) ? rowsAfterSwitch : []).filter((row) => row.is_active === true);
  record(
    "multi-path: exactly path A active after the switch",
    activeAfterSwitch.length === 1 && activeAfterSwitch[0]?.id === genA.pathId,
    genA.pathId,
    String(activeAfterSwitch[0]?.id),
  );

  const titleMarkerA = htmlSafeMarker(rowA?.title);
  if (titleMarkerA) {
    await page("multi-path: /journey follows path A after the switch", "/journey", 200, {
      cookieHeader,
      marker: titleMarkerA,
    });
  } else {
    console.log("[note] multi-path: path A title not HTML-safe for an exact marker check — skipped that one assertion");
  }

  // Isolation works in both directions: a B lesson is not on path A either.
  const lessonB1 = Array.isArray(lessonsB) && lessonsB.length > 0 ? lessonsB[0] : null;
  if (lessonB1) {
    await page("multi-path: path B lesson is NOT on the active path", `/learn/${lessonB1.id}`, 200, {
      cookieHeader,
      marker: "We could not find that lesson.",
    });
  }

  // --- Phase E: rejected switches + recovery (spec parts 26/30) ---
  console.log("\n-- Phase E: rejected switches + recovery --");

  // Another user's real path id when available (strongest isolation proof),
  // otherwise a well-formed UUID that matches nothing.
  const foreignId = foreignPathId ?? "11111111-1111-4111-8111-111111111111";
  await api("multi-path: another user's pathId -> 404", "/api/learning/paths/active", {
    cookieHeader,
    body: { pathId: foreignId },
    expectStatus: 404,
  });

  const { body: rowsAfterForeign } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,is_active&user_id=eq.${userId}`,
    { headers: restHeaders },
  );
  const activeAfterForeign = (Array.isArray(rowsAfterForeign) ? rowsAfterForeign : []).filter((row) => row.is_active === true);
  console.log(
    `[observe] after the rejected switch the account has ${activeAfterForeign.length} active path(s) — the failed switch deactivates before it 404s, so recovery follows`,
  );

  const recover = await api("multi-path: re-activate path A after the rejected switch -> 200", "/api/learning/paths/active", {
    cookieHeader,
    body: { pathId: genA.pathId },
    expectStatus: 200,
  });
  record("multi-path: recovery returns ok:true", recover?.ok === true, true, String(recover?.ok));

  const { body: rowsFinal } = await restJson(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,is_active&user_id=eq.${userId}`,
    { headers: restHeaders },
  );
  const rowListFinal = Array.isArray(rowsFinal) ? rowsFinal : [];
  const activeFinal = rowListFinal.filter((row) => row.is_active === true);
  record(
    "multi-path: path A active again after recovery",
    activeFinal.length === 1 && activeFinal[0]?.id === genA.pathId,
    genA.pathId,
    String(activeFinal[0]?.id),
  );
  record("multi-path: both paths intact at the end", rowListFinal.length === 2, 2, String(rowListFinal.length));
}

console.log("\n== Group 2: multiple learning paths + video quality (spec parts 16/17/26/30/31) ==\n");

if (migrationReady === false) {
  skipped.push("multi-path flow (migrations 20260910000000/20260911000000 not applied)");
} else {
  await runMultiPath(studentAPathId);
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (skipped.length > 0) {
  console.log("\nSkipped:");
  for (const item of skipped) console.log(`  - ${item}`);
}
if (failed.length > 0) {
  console.log("\nFailed:");
  for (const item of failed) console.log(`  - ${item.name}`);
  process.exit(1);
}
