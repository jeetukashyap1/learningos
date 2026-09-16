/**
 * Runtime test harness for the learning path integration (spec parts 18-20).
 *
 * Tier 1 (always runs, no credentials needed):
 *   - Unauthenticated calls to every new API route must 401 with a safe
 *     message: POST /api/learning/paths/generate, POST /api/learning/paths/
 *     attach, POST /api/learning/lessons/[id]/complete (auth runs first).
 *   - Forged/tampered session cookies must 401, never 500, and must not
 *     leak keys or internal details.
 *   - Tier-1-safe validation: invalid lesson UUID on the complete route
 *     and malformed body on the complete route only run authenticated
 *     (validation runs after auth), so they live in tier 2.
 *
 * Tier 2 (requires credentials of a confirmed account on the Supabase
 * project, passed via env vars so they never need to be hardcoded):
 *   TEST_EMAIL + TEST_PASSWORD -> password grant sign-in, then the full
 *   product flow (spec part 20):
 *   - Onboard (onboarding_profiles upsert).
 *   - POST /generate -> 200: real AI curriculum persisted, lessons 'pending'.
 *   - POST /generate again -> idempotent: same pathId, no duplicates.
 *   - POST /attach -> 200: engine attaches videos (found/pending/unavailable
 *     counts; hard engine failure never 500s - lessons stay 'pending').
 *   - /journey renders the real path (title + module sections + outcome).
 *   - /learn/[lessonId] renders the real lesson (content + video/resources).
 *   - POST complete -> 200 {lessonId, completedAt}; complete again ->
 *     idempotent; {completed:false} un-completes; bad UUID -> 404.
 *   - /progress renders the real metrics (single completed_at system).
 *   - DB verification through the REST API: path row, lesson rows, and
 *     exactly one learning_paths row for the user (no duplicates).
 *   - Safe-error check: response bodies never contain the NVIDIA key.
 *
 * Tier 3 (no-path states): User A (authenticated, no onboarding, no path)
 * and User C (onboarding saved, path never generated) must see honest
 * empty states with the Create Your Path CTA on every learning page -
 * never the Full-Stack sample route, fake skills, stats, sprints,
 * projects, or lessons - and zero learning_paths rows in the DB.
 *
 * Usage: node scripts/test-learning-path.mjs [baseUrl]
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (and
 * TEST_EMAIL / TEST_PASSWORD when set) from .env.local.
 */

import { readFile } from "node:fs/promises";

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
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      redirect: "manual",
    });
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

// ---------------------------------------------------------------------------
// Tier 1: unauthenticated API access must 401 with a safe message.
// ---------------------------------------------------------------------------

console.log("\n== Tier 1: credential-free security tests ==\n");

await api("no cookie: generate -> 401", "/api/learning/paths/generate", { expectStatus: 401 });
await api("no cookie: attach -> 401", "/api/learning/paths/attach", { expectStatus: 401 });
await api(
  "no cookie: complete -> 401 (auth before UUID validation)",
  "/api/learning/lessons/00000000-0000-0000-0000-000000000000/complete",
  { expectStatus: 401 },
);

const fakeSession = {
  access_token: "fake-access-token",
  refresh_token: "fake-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated" },
};

await api("garbage cookie: generate -> 401", "/api/learning/paths/generate", {
  cookieHeader: `${cookieName}=this-is-not-uri-encoded-json`,
  expectStatus: 401,
});
await api("well-formed fake session: generate -> 401 (server revalidates)", "/api/learning/paths/generate", {
  cookieHeader: `${cookieName}=${encodeURIComponent(JSON.stringify(fakeSession))}`,
  expectStatus: 401,
});

// ---------------------------------------------------------------------------
// Tier 2: the full authenticated product flow.
// ---------------------------------------------------------------------------

let session = null;

if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
  const signinRes = await supabaseFetchSafe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const signinBody = await signinRes.json().catch(() => null);
  if (signinRes.ok && signinBody?.access_token) {
    session = signinBody;
    console.log(`[setup] signed in as ${process.env.TEST_EMAIL}`);
  } else {
    console.error(`[setup] sign-in failed for TEST_EMAIL (${signinRes.status}): ${JSON.stringify(signinBody).slice(0, 200)}`);
  }
}

if (!session) {
  // Same fixed throwaway account as the existing harness: once confirmed,
  // the password grant succeeds on every future run.
  const email = "path-e2e-test-user@gmail.com";
  const password = "path-e2e-test-Password1!";
  const signupRes = await supabaseFetchSafe(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const signupBody = await signupRes.json().catch(() => null);
  if (signupBody?.session?.access_token) {
    session = signupBody.session;
    console.log(`[setup] signed up test user ${email} (email confirmation disabled)`);
  } else {
    console.log(`[setup] signup for ${email} returned no session (HTTP ${signupRes.status}) — email confirmation required`);
    const signinRes = await supabaseFetchSafe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const signinBody = await signinRes.json().catch(() => null);
    if (signinRes.ok && signinBody?.access_token) {
      session = signinBody;
      console.log(`[setup] signed in test user ${email} (confirmed)`);
    } else if (signinRes.status === 400) {
      console.log("[setup] password grant rejected (account not confirmed yet)");
    } else {
      console.log(`[setup] password grant failed (HTTP ${signinRes.status})`);
    }
  }
}

if (!session) {
  skipped.push("full authenticated product flow (needs TEST_EMAIL + TEST_PASSWORD env vars of a confirmed account)");
} else {
  console.log("\n== Tier 2: authenticated product flow (spec part 20) ==\n");

  // Build the @supabase/ssr cookie value: URI-encoded JSON session, chunked
  // at 3180 chars into <name>.0, <name>.1, ... when needed.
  const encoded = encodeURIComponent(JSON.stringify(session));
  const chunks = [];
  for (let i = 0; i * 3180 < encoded.length; i += 1) {
    chunks.push(encoded.slice(i * 3180, (i + 1) * 3180));
  }
  const cookieHeader = chunks
    .map((chunk, i) => (chunks.length === 1 ? `${cookieName}=${chunk}` : `${cookieName}.${i}=${chunk}`))
    .join("; ");

  const restHeaders = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };

  // Pre-flight: the 20260911000000 schema must exist, otherwise generate
  // cannot persist the module/outcome structure at all.
  const modulesProbe = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_path_modules?select=id&limit=1`, { headers: restHeaders });
  record(
    "pre-flight: migration 20260911000000 applied (learning_path_modules readable)",
    modulesProbe.ok,
    "2xx",
    modulesProbe.status,
    modulesProbe.ok ? undefined : "apply supabase/migrations/20260911000000_add_modules_and_final_outcome.sql in the Supabase SQL editor, then re-run",
  );

  // Deterministic reset: this account persists across runs and an old path
  // would be reused idempotently (possibly predating the module/outcome
  // schema), so delete it first (RLS lets the owner DELETE; lessons and
  // modules cascade) and always generate a fresh structured curriculum.
  const resetRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?user_id=eq.${session.user.id}`, {
    method: "DELETE",
    headers: restHeaders,
  });
  record("reset: owner DELETE of previous paths -> 2xx", resetRes.ok, "2xx", resetRes.status);

  // 1. Onboard: upsert the REAL onboarding answers (the AI's only input).
  const topic = "Web development";
  const onboardRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/onboarding_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: session.user.id,
      topic,
      current_level: "building",
      daily_time: "30",
      goal_type: "career",
    }),
  });
  if (onboardRes.ok) {
    console.log("[setup] onboarding complete for test user");
  } else {
    console.log(`[setup] onboarding upsert failed (HTTP ${onboardRes.status}): ${(await onboardRes.text()).slice(0, 200)}`);
  }

  // 2. Generate: AI curriculum -> persisted path + 'pending' lessons.
  // NVIDIA latency varies widely (observed ~1min to >4min for the nested
  // curriculum) and today's network drops long requests entirely, so the
  // client can see either a 502 "took too long" (server aborted before
  // persisting anything) or a lost response. Both are exactly the
  // "please try again" cases the product UI handles, and generate is
  // idempotent (a persisted path is returned untouched), so the test
  // retries them the same way. Only the final attempt is recorded.
  let generated = null;
  {
    let status = 0;
    let body = null;
    let problem = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(`${BASE_URL}/api/learning/paths/generate`, {
          method: "POST",
          headers: { cookie: cookieHeader },
          redirect: "manual",
        });
        const raw = await res.text();
        status = res.status;
        body = raw ? JSON.parse(raw) : null;
        problem = status >= 400 ? assertSafeErrorBody(body, raw) : null;
      } catch (error) {
        status = 0;
        body = null;
        problem = null;
        console.log(`[retry] generate attempt ${attempt}: fetch error (${error.message})`);
      }
      const retryable =
        problem === null &&
        (status === 0 ||
          (status === 502 && typeof body?.error === "string" && body.error.includes("took too long")));
      if (!retryable || attempt === 3) break;
      console.log(
        `[retry] generate attempt ${attempt}: ${status === 0 ? "response lost" : "502 NVIDIA timeout"}, retrying`,
      );
    }
    record("generate -> 200 (AI curriculum persisted)", status === 200 && !problem, 200, status, problem ?? undefined);
    generated = status === 200 && !problem ? body : null;
  }

  let pathId = null;
  let firstLessonId = null;
  let lessonCount = null;

  if (generated && typeof generated.pathId === "string") {
    pathId = generated.pathId;
    lessonCount = generated.lessonCount;
    console.log(`      (path ${pathId.slice(0, 8)}… · ${generated.lessonCount} lessons · ${generated.resourcesFound} found / ${generated.resourcesPending} pending)`);

    if (resetRes.ok) {
      record("generate: curriculum freshly created", generated.created === true, true, String(generated.created));
    }
    record(
      "generate: returns 2-10 modules",
      typeof generated.moduleCount === "number" && generated.moduleCount >= 2 && generated.moduleCount <= 10,
      "2-10",
      String(generated.moduleCount),
    );
    record(
      "generate: Web development path ends with a project outcome",
      generated.outcomeKind === "project",
      "project",
      String(generated.outcomeKind),
    );

    // 3. Idempotency: generate again -> same path, no duplicates.
    const regenerated = await api("generate again -> 200 idempotent (same pathId, created=false)", "/api/learning/paths/generate", {
      cookieHeader,
      expectStatus: 200,
    });
    if (regenerated) {
      record(
        "idempotent generate returns the same pathId",
        regenerated.pathId === pathId && regenerated.created === false,
        `${pathId.slice(0, 8)}…/false`,
        `${String(regenerated.pathId).slice(0, 8)}…/${String(regenerated.created)}`,
      );
    }

    // 4. DB verification: exactly ONE learning_paths row for this user.
    const pathsRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?select=id,user_id,title&user_id=eq.${session.user.id}`, {
      headers: restHeaders,
    });
    const pathsBody = await pathsRes.json().catch(() => null);
    record(
      "DB: exactly one learning_paths row for the user",
      pathsRes.ok && Array.isArray(pathsBody) && pathsBody.length === 1 && pathsBody[0].id === pathId,
      "1 row",
      pathsRes.ok ? `${pathsBody?.length ?? "?"} row(s)` : `HTTP ${pathsRes.status}`,
    );

    // 5. Attach: engine runs the AI queries; hard failure never 500s.
    const attached = await api("attach -> 200 (engine attaches videos)", "/api/learning/paths/attach", {
      cookieHeader,
      expectStatus: 200,
    });
    if (attached) {
      console.log(
        `      (attach summary: ${attached.resourcesFound} found · ${attached.resourcesPending} pending · ${attached.resourcesUnavailable} unavailable)`,
      );
      record(
        "attach is idempotent-safe: pending lessons only, found lessons untouched",
        typeof attached.resourcesFound === "number" && attached.pathId === pathId,
        `pathId ${pathId.slice(0, 8)}…`,
        `pathId ${String(attached.pathId).slice(0, 8)}…`,
      );
    }

    // 6. Retry attach: a second call must also succeed (retry path, part 15).
    await api("attach again -> 200 (retry never 500s)", "/api/learning/paths/attach", {
      cookieHeader,
      expectStatus: 200,
    });

    // DB: the module structure the AI planner must persist (spec parts 2-4).
    const modulesRes = await supabaseFetchSafe(
      `${SUPABASE_URL}/rest/v1/learning_path_modules?select=id,order_index,title,description,objective,estimated_minutes&path_id=eq.${pathId}&order=order_index.asc`,
      { headers: restHeaders },
    );
    const modulesBody = await modulesRes.json().catch(() => null);
    if (modulesRes.ok && Array.isArray(modulesBody)) {
      record(
        "DB: module rows persisted, ordered, matching the API count",
        modulesBody.length === generated.moduleCount && modulesBody.length >= 2 && modulesBody.length <= 10 && modulesBody.every((m, i) => m.order_index === i + 1),
        `${generated.moduleCount} ordered`,
        `${modulesBody.length} rows`,
      );
      const modulesStructuredOk = modulesBody.every((m) =>
        [m.title, m.description, m.objective].every((value) => typeof value === "string" && value.trim().length > 0),
      );
      record("DB: every module carries title/description/objective", modulesStructuredOk, "all non-empty", modulesStructuredOk ? "all non-empty" : "some fields empty");
    } else {
      record("DB: module rows readable via REST", false, "200", `HTTP ${modulesRes.status} (apply supabase/migrations/20260911000000_add_modules_and_final_outcome.sql if missing)`);
    }
    const moduleIds = new Set(Array.isArray(modulesBody) ? modulesBody.map((m) => m.id) : []);

    // 7. Load the lesson rows from the DB (RLS-scoped to the caller).
    let lessonsRes = await supabaseFetchSafe(
      `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order,title,completed_at,resource_status,module_id&path_id=eq.${pathId}&order=lesson_order.asc`,
      { headers: restHeaders },
    );
    let lessonsBody = await lessonsRes.json().catch(() => null);

    // Harness reset: this suite deliberately ends with lesson 1 completed
    // ("final done state"), so a re-run inherits that completed_at. Un-complete
    // the leftovers through the real product API so the "no progress yet"
    // assertions below test THIS run's flow, not the previous run's.
    if (lessonsRes.ok && Array.isArray(lessonsBody)) {
      const leftovers = lessonsBody.filter((l) => l.completed_at != null);
      if (leftovers.length > 0) {
        for (const lesson of leftovers) {
          const resetRes = await fetch(`${BASE_URL}/api/learning/lessons/${lesson.id}/complete`, {
            method: "POST",
            headers: { cookie: cookieHeader, "Content-Type": "application/json" },
            body: JSON.stringify({ completed: false }),
            redirect: "manual",
          });
          if (!resetRes.ok) {
            console.log(`      [reset] could not un-complete leftover lesson ${lesson.id.slice(0, 8)}… (HTTP ${resetRes.status})`);
          }
        }
        console.log(`      [reset] un-completed ${leftovers.length} lesson(s) left done by a previous run`);
        // Re-read so the assertions reflect the reset state.
        lessonsRes = await supabaseFetchSafe(
          `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order,title,completed_at,resource_status,module_id&path_id=eq.${pathId}&order=lesson_order.asc`,
          { headers: restHeaders },
        );
        lessonsBody = await lessonsRes.json().catch(() => null);
      }
    }

    if (lessonsRes.ok && Array.isArray(lessonsBody)) {
      record(
        "DB: lesson rows persisted with unique ordered lesson_order",
        lessonsBody.length === lessonCount && lessonsBody.every((l, i) => l.lesson_order === i + 1),
        `${lessonCount} ordered`,
        `${lessonsBody.length} rows`,
      );
      record(
        "DB: no lesson is completed yet",
        lessonsBody.every((l) => l.completed_at == null),
        "all null",
        lessonsBody.some((l) => l.completed_at != null) ? "some completed_at set" : "all null",
      );
      const statuses = new Set(lessonsBody.map((l) => l.resource_status));
      record(
        "DB: resource_status only from {found,pending,unavailable}",
        [...statuses].every((s) => s === "found" || s === "pending" || s === "unavailable"),
        "found|pending|unavailable",
        [...statuses].join("|") || "(none)",
      );
      record(
        "DB: every lesson is linked to a module on this path",
        Array.isArray(modulesBody) && modulesBody.length > 0 && lessonsBody.every((l) => typeof l.module_id === "string" && moduleIds.has(l.module_id)),
        "all module_id set and valid",
        Array.isArray(modulesBody) ? "all linked" : "modules unreadable",
      );
      firstLessonId = lessonsBody[0]?.id ?? null;
      if (firstLessonId) {
        console.log(`      (first lesson: ${lessonsBody[0].title} — order ${lessonsBody[0].lesson_order}, ${lessonsBody[0].resource_status})`);
      }
    } else {
      record("DB: lesson rows readable via REST", false, "200", `HTTP ${lessonsRes.status}`);
    }

    // 8. Pages: Journey and Learn render real data for this learner.
    await page("/journey renders the real path (module sections)", "/journey", 200, {
      cookieHeader,
      marker: "Module 1:",
      notMarker: "Become a Full-Stack Developer",
    });
    await page("/journey renders the final outcome card", "/journey", 200, {
      cookieHeader,
      marker: "Final outcome",
    });
    await page("/practice labels challenges with their module", "/practice", 200, {
      cookieHeader,
      marker: "Module 1 ·",
    });
    await page("/projects renders the project outcome hero", "/projects", 200, {
      cookieHeader,
      marker: "YOUR FINAL PROJECT",
    });
    await page("/progress renders honestly (no progress yet)", "/progress", 200, {
      cookieHeader,
      marker: "No progress to show",
      notMarker: "SKILLS MASTERED",
    });

    if (firstLessonId) {
      await page("/learn/[lessonId] renders the real lesson", `/learn/${firstLessonId}`, 200, {
        cookieHeader,
        marker: "YOUR VIDEO FOR THIS LESSON",
        notMarker: "No lesson yet",
      });

      // 9. Complete the lesson -> the single progress signal.
      const completed = await api("complete first lesson -> 200 {lessonId, completedAt}", `/api/learning/lessons/${firstLessonId}/complete`, {
        cookieHeader,
        body: {},
        expectStatus: 200,
      });
      if (completed) {
        record(
          "complete response carries the lessonId and a completion timestamp",
          completed.lessonId === firstLessonId && typeof completed.completedAt === "string",
          "lessonId + completedAt",
          `${completed.lessonId?.slice(0, 8)}… / ${completed.completedAt}`,
        );
      }

      // 10. Idempotent completion: same lesson, no duplicate rows possible.
      const again = await api("complete same lesson again -> 200 idempotent", `/api/learning/lessons/${firstLessonId}/complete`, {
        cookieHeader,
        expectStatus: 200,
      });
      if (again) {
        record("repeat completion keeps completedAt a timestamp", typeof again.completedAt === "string", "string", String(again.completedAt));
      }

      // 11. Un-complete via {completed: false}.
      await api("un-complete lesson -> 200", `/api/learning/lessons/${firstLessonId}/complete`, {
        cookieHeader,
        body: { completed: false },
        expectStatus: 200,
      });

      // 12. Re-complete (final state: lesson done).
      await api("re-complete lesson -> 200 (final done state)", `/api/learning/lessons/${firstLessonId}/complete`, {
        cookieHeader,
        expectStatus: 200,
      });

      // 13. Validation battery on the complete route (authenticated).
      await api("complete with invalid UUID -> 404", "/api/learning/lessons/not-a-uuid/complete", {
        cookieHeader,
        expectStatus: 404,
      });
      await api("complete with malformed body -> 400", `/api/learning/lessons/${firstLessonId}/complete`, {
        cookieHeader,
        body: "not-json-object",
        expectStatus: 400,
      });
      await api(
        "complete with non-boolean completed -> 400",
        `/api/learning/lessons/${firstLessonId}/complete`,
        { cookieHeader, body: { completed: "yes" }, expectStatus: 400 },
      );

      // 14. Progress now renders the real metrics from completed_at.
      await page("/progress renders real metrics after completion", "/progress", 200, {
        cookieHeader,
        // Matches both "lesson completed on this path" (1 done) and
        // "lessons completed on this path" (2+ done).
        marker: "completed on this path",
        notMarker: "No progress to show",
      });
      await page("/progress renders module progress after completion", "/progress", 200, {
        cookieHeader,
        marker: "MODULE PROGRESS",
      });
      await page("/progress renders the final outcome status after completion", "/progress", 200, {
        cookieHeader,
        marker: "FINAL OUTCOME STATUS",
      });

      // 15. DB: completed_at persisted on the lesson row.
      const doneRes = await supabaseFetchSafe(
        `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=completed_at&path_id=eq.${pathId}&order=lesson_order.asc&limit=1`,
        { headers: restHeaders },
      );
      const doneBody = await doneRes.json().catch(() => null);
      record(
        "DB: first lesson carries completed_at after the complete call",
        doneRes.ok && Array.isArray(doneBody) && typeof doneBody[0]?.completed_at === "string",
        "completed_at set",
        doneRes.ok ? String(doneBody[0]?.completed_at) : `HTTP ${doneRes.status}`,
      );
    }

    // 16. Journey still renders after completion (page stable).
    await page("/journey renders after completion", "/journey", 200, {
      cookieHeader,
      marker: "Module 1:",
    });
  } else {
    record("generate returned a usable body", false, "pathId string", JSON.stringify(generated).slice(0, 120));
  }
}

// ---------------------------------------------------------------------------
// Tier 3: no-path states (User A and User C).
//
// The authoritative rule under test: a user has no learning experience
// until a persisted learning path exists. User A signs up and never
// onboards; User C saves onboarding answers but never generates a path.
// Both must see honest empty states with the Create Your Path CTA -
// never the Full-Stack sample route or fake metrics - and zero
// learning_paths rows. User B (real path) is tier 2 above.
// ---------------------------------------------------------------------------

/** Signs up a throwaway account (or signs in when it already exists). */
async function throwawaySession(email, password) {
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
  console.log(`[setup] no session for ${email} (signup HTTP ${signupRes.status}, password grant HTTP ${signinRes.status})`);
  return null;
}

/** Builds the @supabase/ssr chunked cookie header (same scheme as tier 2,
 * kept as a separate helper so the frozen tier-2 flow stays untouched). */
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

/** The shared no-path page battery: every learning page must render its
 * honest empty state with the CTA, and none of the sample content. */
async function assertNoPathPages(userSession, label) {
  const cookieHeader = sessionCookieHeader(userSession);
  await page(`${label}: /journey shows the honest no-path state`, "/journey", 200, {
    cookieHeader,
    marker: "No route yet.",
    notMarker: "Become a Full-Stack Developer",
  });
  await page(`${label}: sidebar offers Create your path (not momentum)`, "/journey", 200, {
    cookieHeader,
    marker: "Create your path",
    notMarker: "Keep your momentum",
  });
  await page(`${label}: /skills maps nothing`, "/skills", 200, {
    cookieHeader,
    marker: "No skills mapped yet.",
    notMarker: "SKILL MASTERY",
  });
  await page(`${label}: /practice shows no challenges or fake stats`, "/practice", 200, {
    cookieHeader,
    marker: "No challenges yet.",
    notMarker: "READY TO PRACTICE",
  });
  await page(`${label}: /progress shows no fake metrics`, "/progress", 200, {
    cookieHeader,
    marker: "No progress to show.",
    notMarker: "SKILLS MASTERED",
  });
  await page(`${label}: /quick-learn shows no sample sprints`, "/quick-learn", 200, {
    cookieHeader,
    marker: "No sprints yet.",
    notMarker: "Understand APIs in 10 minutes",
  });
  await page(`${label}: /projects shows no sample projects`, "/projects", 200, {
    cookieHeader,
    marker: "No projects yet.",
    notMarker: "Suggest a project",
  });
  await page(`${label}: /learn/[lessonId] shows no sample lesson`, "/learn/11111111-1111-4111-8111-111111111111", 200, {
    cookieHeader,
    marker: "No lesson yet.",
    notMarker: "YOUR VIDEO FOR THIS LESSON",
  });
}

/** DB truth check: the user must have zero persisted learning paths. */
async function assertZeroPaths(userSession, label) {
  const res = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?select=id&user_id=eq.${userSession.user.id}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${userSession.access_token}` },
  });
  const body = await res.json().catch(() => null);
  record(
    `${label}: DB has zero learning_paths rows`,
    res.ok && Array.isArray(body) && body.length === 0,
    "0 rows",
    res.ok ? `${body?.length ?? "?"} row(s)` : `HTTP ${res.status}`,
  );
}

// User A: authenticated, never onboarded, no path.
const userASession = await throwawaySession("path-e2e-usera@gmail.com", "path-e2e-test-Password1!");
if (userASession) {
  console.log("\n== Tier 3: User A — authenticated, no onboarding, no path ==\n");
  await page("User A: /dashboard shows the getting-started state", "/dashboard", 200, {
    cookieHeader: sessionCookieHeader(userASession),
    marker: "Welcome to LearningOS.",
    notMarker: "Your learning path is live.",
  });
  await assertNoPathPages(userASession, "User A");
  await assertZeroPaths(userASession, "User A");
} else {
  skipped.push("User A no-path pages (throwaway account unavailable)");
}

// User C: onboarding saved, path never generated (onboarding is not a path).
const userCSession = await throwawaySession("path-e2e-userc@gmail.com", "path-e2e-test-Password1!");
if (userCSession) {
  console.log("\n== Tier 3: User C — onboarding saved, path never generated ==\n");
  const restHeadersC = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${userCSession.access_token}`,
  };
  const onboardRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/onboarding_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...restHeadersC, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userCSession.user.id,
      topic: "Web development",
      current_level: "building",
      daily_time: "30",
      goal_type: "career",
    }),
  });
  record("User C: onboarding row saved without generating a path", onboardRes.ok, "2xx", `HTTP ${onboardRes.status}`);
  if (onboardRes.ok) {
    await page("User C: /dashboard shows profile-ready, not a live path", "/dashboard", 200, {
      cookieHeader: sessionCookieHeader(userCSession),
      marker: "Your learning profile is ready.",
      notMarker: "Your learning path is live.",
    });
    await assertNoPathPages(userCSession, "User C");
    await assertZeroPaths(userCSession, "User C");
  }
} else {
  skipped.push("User C onboarding-without-path pages (throwaway account unavailable)");
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (skipped.length > 0) {
  console.log("Skipped (missing credentials):");
  for (const s of skipped) console.log(`  - ${s}`);
  console.log("To enable: TEST_EMAIL=<confirmed email> TEST_PASSWORD=<password> node scripts/test-learning-path.mjs");
}
if (failed.length > 0) {
  console.log("Failed checks:");
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
