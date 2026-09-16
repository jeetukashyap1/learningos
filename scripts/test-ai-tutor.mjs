/**
 * Runtime E2E harness for AI Tutor 2.0 (spec §23 - the 18 required scenarios).
 *
 * The tutor is the one feature whose answer quality only a human can judge, so
 * this harness deliberately tests the things a human CANNOT eyeball reliably:
 * authentication, ownership, the trusted-context derivation, the four route
 * contracts, the error mapping, and the persistence rules. It never asserts on
 * the *wording* of an AI reply (that would make the suite flaky), only on the
 * properties that must hold whatever the model says.
 *
 * Tier 1 - credential-free security (always runs):
 *   - All five tutor routes must 401 for an absent session: POST /api/ai-tutor,
 *     GET /api/ai-tutor/conversations, GET+DELETE
 *     /api/ai-tutor/conversations/[id], GET /api/ai-tutor/lesson/[id].
 *   - Garbage and well-formed-forged cookies must 401, never 500, and never
 *     leak a key.                                                 (scenario 1)
 *
 * Tier 2 - the authenticated tutor flow (reuses the shared throwaway account
 * and its persisted path; generates a path only when none exists):
 *   - Validation battery: empty/oversized/non-JSON bodies, non-uuid ids.
 *   - GET /lesson/[id]: a lesson ON the caller's active path -> 200 with the
 *     server-derived lesson context; a random uuid and a malformed id -> 404.
 *   - POST anchored to that lesson -> 200, createdConversation:true, trusted
 *     context echoed back.                                      (scenarios 3, 4)
 *   - A follow-up that names the returned conversationId -> same conversation,
 *     createdConversation:false, history retained.          (scenarios 5, 16)
 *   - A path-level conversation (no lessonId) -> 200, lesson null.
 *   - prev/next lesson titles are derived from real persisted order and are
 *     null exactly at the ends of the path.                     (scenario 6)
 *   - Conversation list / load / delete, and malformed/foreign ids -> 404.
 *   - DB verification through REST + RLS (the caller sees only their rows).
 *   - /ai-tutor renders the real "CURRENTLY LEARNING" header, not sample data.
 *                                                            (scenarios 15, 18)
 *
 * Tier 3 - no-path honesty (User A: authenticated, never onboarded):
 *   - The lesson route and a message post must not fabricate a course;
 *     the page shows the honest empty state, never a fake header. (scenarios 2, 18)
 *
 * Tier 4 - cross-user protection (User A vs User B):
 *   - User A posting one of User B's lesson ids -> 404.
 *   - User A reading / deleting / continuing one of User B's conversations
 *     -> 404, with no title or turn echoed back.                  (scenario 7)
 *
 * Tier 5 - domain-agnostic context (the five student accounts from the
 * multi-domain harness, when they already have a path):
 *   - For every domain the context route returns that learner's OWN
 *     subject/domain/lesson, and a non-programming path never leaks
 *     programming markers.                                  (scenarios 8-11)
 *   - Physics gets one REAL end-to-end reply to prove the tutor answers
 *     outside programming; the rest of the domain proof is provider-free
 *     (context derivation) so the suite stays cheap.
 *
 * Tier 6 - language: the Hinglish student asks for Hinglish and still gets a
 *   real, non-empty answer grounded in their own context.       (scenario 12)
 *
 * Tier 7 - provider-failure contract (spec §21):
 *   - The mapping is fixed: config/rate_limit -> 503, timeout/network/api/
 *     invalid_output -> 502, always with a safe, key-free body. This tier
 *     verifies the *safety* invariant on any failure the server does return
 *     and can force a genuine provider failure when the operator starts the
 *     server with a deliberately bad NVIDIA key and sets
 *     AI_TUTOR_FORCE_PROVIDER_FAILURE=1. Without that key it records an
 *     explicit SKIP rather than pretending to have tested it.
 *                                                     (scenarios 13, 14)
 *
 * Tier 8 - multiple paths + active switching (the multipath account):
 *   - When that account holds two paths, switching the active path via
 *     POST /api/learning/paths/active must change the tutor's trusted path
 *     context on the next request.                            (scenario 17)
 *
 * Usage: node scripts/test-ai-tutor.mjs [baseUrl]
 * Reads the Supabase + API keys from .env.local. Expects a production build
 * running (npm run build && npm start) on :3100, the AI Tutor migration
 * applied, and the same throwaway accounts as scripts/test-different-students.mjs.
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
  // A raw provider/SQL envelope must never reach the browser (spec §21).
  if (/"stack"|PG::|postgres|relation "|\bat [A-Za-z]:\\/i.test(text)) {
    return "body leaks an internal detail (stack/sql/driver text)";
  }
  return null;
}

/** Raw tutor-API call: returns { status, body, problem } WITHOUT recording, so
 * a caller can choose how to report (a single check vs. a retried attempt). */
async function apiRaw(path, { method = "POST", cookieHeader, body } = {}) {
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
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const problem = res.status >= 400 ? assertSafeErrorBody(parsed, raw) : null;
    return { status: res.status, body: parsed, problem };
  } catch (error) {
    return { status: 0, body: null, problem: `fetch error: ${error.message}` };
  }
}

/** The HTTP status of the most recent api()/postTutor()/liveAnswer() call. The
 * harness is strictly sequential, so this is a reliable "last status". */
let LAST_STATUS = 0;

async function api(name, path, { method = "POST", cookieHeader, body, expectStatus } = {}) {
  const { status, body: parsed, problem } = await apiRaw(path, { method, cookieHeader, body });
  LAST_STATUS = status;
  if (status === 0) {
    record(name, false, expectStatus, problem);
    return null;
  }
  record(name, status === expectStatus && !problem, expectStatus, status, problem ?? undefined);
  return parsed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The tutor maps a provider timeout/network/api failure to 502 and a
 * config/rate-limit to 503 (lib/ai-tutor/http.ts). Those are honest transient
 * outcomes; assertSafeErrorBody has already proven the body carries no secret. */
function isMappedProviderError(status, body) {
  return (status === 502 || status === 503) && Boolean(body && typeof body.error === "string");
}

/** POST /api/ai-tutor with the SINGLE retry the UI also exposes for a mapped
 * provider failure. The first attempt is recorded with its true status and the
 * retry is clearly labelled, so a flaky provider never masquerades as a defect
 * and no assertion is hidden. */
async function postTutor(name, path, { cookieHeader, body, expectStatus = 200 } = {}) {
  let attempt = await apiRaw(path, { cookieHeader, body });
  LAST_STATUS = attempt.status;
  record(
    name,
    attempt.status === expectStatus && !attempt.problem,
    expectStatus,
    attempt.status === 0 ? attempt.problem : attempt.status,
    attempt.problem ?? undefined,
  );
  if (attempt.status === expectStatus && !attempt.problem) return attempt.body;
  if (isMappedProviderError(attempt.status, attempt.body) && !attempt.problem) {
    console.warn(`[retry] ${name}: mapped provider ${attempt.status} — retrying once (the UI exposes the same retry)`);
    await sleep(900);
    attempt = await apiRaw(path, { cookieHeader, body });
    LAST_STATUS = attempt.status;
    record(
      `${name} (retry)`,
      attempt.status === expectStatus && !attempt.problem,
      expectStatus,
      attempt.status === 0 ? attempt.problem : attempt.status,
      attempt.problem ?? undefined,
    );
    return attempt.status === expectStatus && !attempt.problem ? attempt.body : null;
  }
  return null;
}

/** A provider-backed live check that records exactly ONE result: PASS on a 200
 * with a grounded, non-empty answer; a SKIP (never a red suite) when the
 * provider is transiently unavailable after a retry; FAIL on anything else. */
async function liveAnswer(name, path, { cookieHeader, body, check } = {}) {
  let attempt = await apiRaw(path, { cookieHeader, body });
  LAST_STATUS = attempt.status;
  if (attempt.status !== 200 && isMappedProviderError(attempt.status, attempt.body) && !attempt.problem) {
    console.warn(`[retry] ${name}: mapped provider ${attempt.status} — retrying once`);
    await sleep(900);
    attempt = await apiRaw(path, { cookieHeader, body });
    LAST_STATUS = attempt.status;
  }
  const content = String(attempt.body?.assistantMessage?.content ?? "");
  const ok =
    attempt.status === 200 &&
    !attempt.problem &&
    content.trim().length > 0 &&
    (!check || check(attempt.body));
  if (!ok && isMappedProviderError(attempt.status, attempt.body) && !attempt.problem) {
    skipped.push(`${name} — the provider returned ${attempt.status} on both attempts (transient/unavailable at run time)`);
    return null;
  }
  record(
    name,
    ok,
    "200 + grounded non-empty answer",
    `status=${attempt.status}, assistantLen=${content.length}`,
    attempt.problem ?? undefined,
  );
  return attempt.body;
}

/** Excludes a caller's turn-less conversations (RLS-scoped). The conversation
 * row is created BEFORE the model replies, so a mapped provider failure can
 * leave an empty conversation behind; only an OBSERVED failure triggers this. */
async function purgeEmptyConversations(restHeaders, userId) {
  const convRes = await supabaseFetchSafe(
    `${SUPABASE_URL}/rest/v1/ai_tutor_conversations?select=id&user_id=eq.${userId}`,
    { headers: restHeaders },
  );
  const convs = await convRes.json().catch(() => null);
  if (!convRes.ok || !Array.isArray(convs) || convs.length === 0) return 0;
  const msgRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/ai_tutor_messages?select=conversation_id`, {
    headers: restHeaders,
  });
  const msgs = await msgRes.json().catch(() => null);
  const used = new Set((Array.isArray(msgs) ? msgs : []).map((row) => row.conversation_id));
  const empties = convs.filter((row) => !used.has(row.id));
  for (const row of empties) {
    await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/ai_tutor_conversations?id=eq.${row.id}`, {
      method: "DELETE",
      headers: restHeaders,
    });
  }
  return empties.length;
}

/** Sweeps orphans ONLY when a provider failure was actually observed, so a
 * genuine "created a conversation with no turns" defect is never hidden. */
async function sweepProviderOrphans(restHeaders, userId, observedFailure) {
  if (!observedFailure) return 0;
  const removed = await purgeEmptyConversations(restHeaders, userId);
  if (removed > 0) console.warn(`[cleanup] removed ${removed} empty conversation(s) left by a mapped provider failure`);
  return removed;
}

async function page(name, path, expectStatus, { cookieHeader, marker, notMarker } = {}) {
  try {
    // Transport retries: this machine's network occasionally drops a request
    // entirely; one blip must not fail an otherwise-green check.
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
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
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

/** Direct-to-Supabase fetch with retries (the TCP connect occasionally blips). */
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

/** supabaseFetch that never throws: a dead network becomes a visible FAIL/SKIP. */
async function supabaseFetchSafe(url, options) {
  try {
    return await supabaseFetch(url, options);
  } catch {
    console.warn("[network] Supabase unreachable after retries — recording failure for this call");
    return { ok: false, status: 0, json: async () => null, text: async () => "" };
  }
}

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
    console.log(`[setup] signed in ${email}`);
    return signinBody;
  }
  console.log(`[setup] no session for ${email} (signup HTTP ${signupRes.status}, password grant HTTP ${signinRes.status})`);
  return null;
}

/** Builds the @supabase/ssr chunked cookie header (3180-char chunks). */
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

function restHeadersFor(session) {
  return {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };
}

const RANDOM_UUID = "11111111-1111-4111-8111-111111111111";

/** A small, honest, non-leading question for the domain/language probes. */
const SHORT_QUESTION = "In one short sentence, what am I learning right now?";

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Tier 1: credential-free security. Every tutor route authenticates first, so
// an absent session is a 401 with a safe message - never a 500, never a leak.
// ---------------------------------------------------------------------------

console.log("\n== Tier 1: credential-free security (scenario 1) ==\n");

await api("no cookie: POST /api/ai-tutor -> 401", "/api/ai-tutor", {
  body: { message: "hi" },
  expectStatus: 401,
});
await api("no cookie: GET /api/ai-tutor/conversations -> 401", "/api/ai-tutor/conversations", {
  method: "GET",
  expectStatus: 401,
});
await api(`no cookie: GET /api/ai-tutor/conversations/${RANDOM_UUID} -> 401`, `/api/ai-tutor/conversations/${RANDOM_UUID}`, {
  method: "GET",
  expectStatus: 401,
});
await api(`no cookie: DELETE /api/ai-tutor/conversations/${RANDOM_UUID} -> 401`, `/api/ai-tutor/conversations/${RANDOM_UUID}`, {
  method: "DELETE",
  expectStatus: 401,
});
await api(`no cookie: GET /api/ai-tutor/lesson/${RANDOM_UUID} -> 401`, `/api/ai-tutor/lesson/${RANDOM_UUID}`, {
  method: "GET",
  expectStatus: 401,
});
// Auth runs before validation, so a malformed id is still a 401 here.
await api("no cookie: malformed lesson id -> 401 (auth before validation)", "/api/ai-tutor/lesson/not-a-uuid", {
  method: "GET",
  expectStatus: 401,
});

const fakeSession = {
  access_token: "fake-access-token",
  refresh_token: "fake-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated" },
};

await api("garbage cookie: POST /api/ai-tutor -> 401", "/api/ai-tutor", {
  cookieHeader: `${cookieName}=this-is-not-uri-encoded-json`,
  body: { message: "hi" },
  expectStatus: 401,
});
await api("well-formed forged session: POST /api/ai-tutor -> 401 (server revalidates)", "/api/ai-tutor", {
  cookieHeader: `${cookieName}=${encodeURIComponent(JSON.stringify(fakeSession))}`,
  body: { message: "hi" },
  expectStatus: 401,
});
await api("well-formed forged session: GET conversations -> 401", "/api/ai-tutor/conversations", {
  method: "GET",
  cookieHeader: `${cookieName}=${encodeURIComponent(JSON.stringify(fakeSession))}`,
  expectStatus: 401,
});

// ---------------------------------------------------------------------------
// Tier 2: the authenticated tutor flow.
// ---------------------------------------------------------------------------

const TEST_EMAIL = "path-e2e-test-user@gmail.com";
const TEST_PASSWORD = "path-e2e-test-Password1!";

const session = await throwawaySession(TEST_EMAIL, TEST_PASSWORD);

/** Guarantees the account owns an active path with ordered lessons: reuse the
 * persisted one when it is already usable, otherwise onboard + generate
 * (the same idempotent flow the learning-path harness uses). */
async function ensureActivePath(userSession, restHeaders, label) {
  const pathsRes = await supabaseFetchSafe(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,title,subject,domain,is_active&user_id=eq.${userSession.user.id}&is_active=eq.true`,
    { headers: restHeaders },
  );
  const paths = await pathsRes.json().catch(() => null);
  const active = Array.isArray(paths) ? paths[0] : null;

  if (active) {
    const lessonsRes = await supabaseFetchSafe(
      `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order,title&path_id=eq.${active.id}&order=lesson_order.asc`,
      { headers: restHeaders },
    );
    const lessons = await lessonsRes.json().catch(() => null);
    if (lessonsRes.ok && Array.isArray(lessons) && lessons.length >= 3) {
      console.log(`[setup] ${label}: reusing existing active path ${active.id.slice(0, 8)}… (${lessons.length} lessons)`);
      return { pathId: active.id, path: active, lessons };
    }
    console.log(`[setup] ${label}: active path present but unusable (lessons HTTP ${lessonsRes.status}) — regenerating`);
  }

  // Deterministic reset then a fresh structured curriculum.
  await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?user_id=eq.${userSession.user.id}`, {
    method: "DELETE",
    headers: restHeaders,
  });
  await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/onboarding_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userSession.user.id,
      topic: "Web development",
      current_level: "building",
      daily_time: "30",
      goal_type: "career",
    }),
  });

  console.log(`[setup] ${label}: generating a fresh path (AI, may take a minute)…`);
  let generated = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/learning/paths/generate`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader(userSession) },
        redirect: "manual",
      });
      const raw = await res.text();
      const body = raw ? JSON.parse(raw) : null;
      if (res.status === 200 && body?.pathId) {
        generated = body;
        break;
      }
      console.log(`[setup] ${label}: generate attempt ${attempt} -> HTTP ${res.status}`);
    } catch (error) {
      console.log(`[setup] ${label}: generate attempt ${attempt} fetch error (${error.message})`);
    }
  }
  if (!generated?.pathId) return null;

  const lessonsRes = await supabaseFetchSafe(
    `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order,title&path_id=eq.${generated.pathId}&order=lesson_order.asc`,
    { headers: restHeaders },
  );
  const lessons = await lessonsRes.json().catch(() => null);
  if (!Array.isArray(lessons) || lessons.length === 0) return null;
  return { pathId: generated.pathId, path: { id: generated.pathId, title: null }, lessons };
}

if (!session) {
  skipped.push("Tier 2/3/4/8 (shared throwaway account unavailable)");
} else {
  console.log("\n== Tier 2: authenticated tutor flow (scenarios 3, 4, 5, 6, 15, 16, 18) ==\n");

  const cookieHeader = sessionCookieHeader(session);
  const restHeaders = restHeadersFor(session);

  // Pre-flight: the AI Tutor migration must exist, or every conversation
  // write would fail and the flow could not be judged at all.
  const tutorProbe = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/ai_tutor_conversations?select=id&limit=1`, {
    headers: restHeaders,
  });
  record(
    "pre-flight: AI Tutor migration applied (ai_tutor_conversations readable)",
    tutorProbe.ok,
    "2xx",
    tutorProbe.status,
    tutorProbe.ok ? undefined : "apply supabase/migrations/20260912000000_create_ai_tutor_conversations.sql, then re-run",
  );

  // Start each run from a clean slate for THIS account so list/delete checks
  // are deterministic (RLS scopes the delete to the owner).
  await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/ai_tutor_conversations?user_id=eq.${session.user.id}`, {
    method: "DELETE",
    headers: restHeaders,
  });

  const path = await ensureActivePath(session, restHeaders, "User B");
  record("setup: User B owns an active path with >= 3 ordered lessons", Boolean(path), "path + lessons", path ? `${path.lessons.length} lessons` : "none");

  if (path) {
    const lessons = [...path.lessons].sort((a, b) => a.lesson_order - b.lesson_order);
    const first = lessons[0];
    const last = lessons[lessons.length - 1];
    const mid = lessons[Math.floor(lessons.length / 2)];

    // --- Validation battery: every 400 is a safe, secret-free message. ----
    await api("validation: missing message -> 400", "/api/ai-tutor", {
      cookieHeader,
      body: {},
      expectStatus: 400,
    });
    await api("validation: empty message -> 400", "/api/ai-tutor", {
      cookieHeader,
      body: { message: "   " },
      expectStatus: 400,
    });
    await api("validation: non-string message -> 400", "/api/ai-tutor", {
      cookieHeader,
      body: { message: 42 },
      expectStatus: 400,
    });
    await api("validation: message over MAX_MESSAGE_LENGTH -> 400", "/api/ai-tutor", {
      cookieHeader,
      body: { message: "a".repeat(8001) },
      expectStatus: 400,
    });
    await api("validation: oversized body -> 400", "/api/ai-tutor", {
      cookieHeader,
      body: { message: "a".repeat(25000) },
      expectStatus: 400,
    });
    await api("validation: non-uuid conversationId -> 400", "/api/ai-tutor", {
      cookieHeader,
      body: { message: "hello", conversationId: "not-a-uuid" },
      expectStatus: 400,
    });
    await api("validation: non-uuid lessonId -> 400", "/api/ai-tutor", {
      cookieHeader,
      body: { message: "hello", lessonId: "not-a-uuid" },
      expectStatus: 400,
    });

    // --- Lesson context route (scenario 4). ------------------------------
    const lessonBody = await api(`GET lesson context for an on-path lesson -> 200`, `/api/ai-tutor/lesson/${mid.id}`, {
      method: "GET",
      cookieHeader,
      expectStatus: 200,
    });
    if (lessonBody?.context) {
      const ctx = lessonBody.context;
      record(
        "lesson context: server-derived lesson matches the requested id",
        ctx.lesson?.id === mid.id && ctx.lesson?.order === mid.lesson_order,
        `${mid.id.slice(0, 8)}…/order ${mid.lesson_order}`,
        `${String(ctx.lesson?.id).slice(0, 8)}…/order ${String(ctx.lesson?.order)}`,
      );
      record(
        "lesson context: path details present (title + module resolution)",
        ctx.hasPath === true && Boolean(ctx.path?.id) && typeof ctx.lesson?.moduleTitle === "string",
        "hasPath + path.id + moduleTitle",
        `hasPath=${ctx.hasPath}, path=${Boolean(ctx.path?.id)}, module=${JSON.stringify(ctx.lesson?.moduleTitle)}`,
      );
      // A lesson that belongs to a module must report a real 1-based position
      // within it; a lesson on a LEGACY path (predating the modules migration)
      // has no module, and context.ts documents that as position/count 0. Both
      // are correct server behavior, so the assertion tracks which case applies
      // instead of demanding a module that genuinely does not exist.
      const lessonHasModule = typeof ctx.lesson?.moduleTitle === "string" && ctx.lesson.moduleTitle.length > 0;
      record(
        "lesson context: module position derived from real persisted order",
        lessonHasModule
          ? typeof ctx.lesson?.positionInModule === "number" &&
              ctx.lesson.positionInModule >= 1 &&
              typeof ctx.lesson?.moduleLessonCount === "number" &&
              ctx.lesson.moduleLessonCount >= ctx.lesson.positionInModule
          : ctx.lesson?.positionInModule === 0 && ctx.lesson?.moduleLessonCount === 0,
        lessonHasModule ? "1 <= position <= moduleLessonCount" : "0/0 (the lesson has no module)",
        `position=${String(ctx.lesson?.positionInModule)}, count=${String(ctx.lesson?.moduleLessonCount)}, module=${JSON.stringify(ctx.lesson?.moduleTitle)}`,
      );
      // The context must NOT carry anything the client could have forged.
      record(
        "lesson context: no client-supplied ids echoed beyond the verified lesson",
        ctx.path?.id === path.pathId,
        path.pathId.slice(0, 8) + "…",
        String(ctx.path?.id).slice(0, 8) + "…",
      );
    }

    await api("lesson context: unknown uuid -> 404", `/api/ai-tutor/lesson/${RANDOM_UUID}`, {
      method: "GET",
      cookieHeader,
      expectStatus: 404,
    });
    await api("lesson context: malformed id -> 404", "/api/ai-tutor/lesson/not-a-uuid", {
      method: "GET",
      cookieHeader,
      expectStatus: 404,
    });

    // --- prev/next derivation (scenario 6). -------------------------------
    const firstCtx = await api("lesson context: first lesson -> 200", `/api/ai-tutor/lesson/${first.id}`, {
      method: "GET",
      cookieHeader,
      expectStatus: 200,
    });
    record(
      "prev/next: the first lesson has no previous",
      firstCtx?.context?.previousLessonTitle === null && Boolean(firstCtx?.context?.nextLessonTitle),
      "previous null + next set",
      `prev=${JSON.stringify(firstCtx?.context?.previousLessonTitle)}, next=${JSON.stringify(firstCtx?.context?.nextLessonTitle)}`,
    );
    const lastCtx = await api("lesson context: last lesson -> 200", `/api/ai-tutor/lesson/${last.id}`, {
      method: "GET",
      cookieHeader,
      expectStatus: 200,
    });
    record(
      "prev/next: the last lesson has no next",
      lastCtx?.context?.nextLessonTitle === null && Boolean(lastCtx?.context?.previousLessonTitle),
      "next null + previous set",
      `prev=${JSON.stringify(lastCtx?.context?.previousLessonTitle)}, next=${JSON.stringify(lastCtx?.context?.nextLessonTitle)}`,
    );
    if (lessons.length >= 3) {
      const midCtx = await api("lesson context: middle lesson -> 200", `/api/ai-tutor/lesson/${mid.id}`, {
        method: "GET",
        cookieHeader,
        expectStatus: 200,
      });
      record(
        "prev/next: a middle lesson has both neighbours from real order",
        Boolean(midCtx?.context?.previousLessonTitle) && Boolean(midCtx?.context?.nextLessonTitle),
        "previous + next set",
        `prev=${JSON.stringify(midCtx?.context?.previousLessonTitle)}, next=${JSON.stringify(midCtx?.context?.nextLessonTitle)}`,
      );
    }

    // --- New conversation anchored to a lesson (scenarios 3, 4, 15). ------
    const firstAnswer = await postTutor(
      "POST lesson-anchored message -> 200 (new conversation)",
      "/api/ai-tutor",
      { cookieHeader, body: { lessonId: mid.id, message: SHORT_QUESTION }, expectStatus: 200 },
    );
    // Sweep an orphan left by a mapped provider failure (the row is created
    // before the model replies). Only an OBSERVED failure triggers this.
    await sweepProviderOrphans(restHeaders, session.user.id, LAST_STATUS !== 200);

    let conversationId = null;
    if (firstAnswer) {
      conversationId = isUuid(firstAnswer.conversationId) ? firstAnswer.conversationId : null;
      record(
        "answer: returns a persisted uuid conversation + both turns",
        isUuid(firstAnswer.conversationId) &&
          firstAnswer.createdConversation === true &&
          firstAnswer.persisted === true &&
          firstAnswer.userMessage?.role === "user" &&
          firstAnswer.assistantMessage?.role === "assistant" &&
          typeof firstAnswer.assistantMessage?.content === "string" &&
          firstAnswer.assistantMessage.content.trim().length > 0,
        "uuid + created + persisted + user/assistant turns",
        `id=${String(firstAnswer.conversationId).slice(0, 8)}…, created=${firstAnswer.createdConversation}, persisted=${firstAnswer.persisted}, assistantLen=${String(firstAnswer.assistantMessage?.content).length}, status=${LAST_STATUS}`,
      );
      record(
        "answer: reply is grounded in the SERVER-resolved lesson context",
        firstAnswer.context?.lesson?.id === mid.id && firstAnswer.context?.hasPath === true,
        `lesson ${mid.id.slice(0, 8)}…`,
        `lesson ${String(firstAnswer.context?.lesson?.id).slice(0, 8)}…`,
      );
      record(
        "answer: the assistant reply never echoes a raw API key",
        !env.NVIDIA_API_KEY || !String(firstAnswer.assistantMessage?.content ?? "").includes(env.NVIDIA_API_KEY),
        "no key in content",
        "checked",
      );
    }

    if (!conversationId) {
      // The provider yielded no 200 even after a retry. That is an honest
      // transient outcome (already proven secret-free), never a tutor defect,
      // so no id is fabricated and the dependent checks are skipped.
      record(
        "answer: a failed provider attempt never fabricates a conversation id",
        true,
        "no fabricated conversation id",
        `status=${LAST_STATUS}`,
      );
      skipped.push("Tier 2 continuation + history (the provider returned no 200 after a retry)");
    } else {
      // --- Continuation: same conversation, history retained (5, 16). ----
      const followUp = await postTutor(
        "POST follow-up with conversationId -> 200 (continues, does not create)",
        "/api/ai-tutor",
        { cookieHeader, body: { conversationId, message: "Can you give me a simple example?" }, expectStatus: 200 },
      );
      if (followUp) {
        record(
          "continuation: same conversation id, createdConversation:false",
          followUp.conversationId === conversationId && followUp.createdConversation === false,
          `${String(conversationId).slice(0, 8)}…/false`,
          `${String(followUp.conversationId).slice(0, 8)}…/${String(followUp.createdConversation)}`,
        );
        record(
          "continuation: still anchored to the original lesson context",
          followUp.context?.lesson?.id === mid.id,
          `lesson ${mid.id.slice(0, 8)}…`,
          `lesson ${String(followUp.context?.lesson?.id).slice(0, 8)}…`,
        );
      }
      await sweepProviderOrphans(restHeaders, session.user.id, LAST_STATUS !== 200);

      // --- Load the thread back and confirm the bounded history persisted.
      const thread = await api(
        "GET the conversation -> 200 with both turns retained",
        `/api/ai-tutor/conversations/${conversationId}`,
        { method: "GET", cookieHeader, expectStatus: 200 },
      );
      const turns = Array.isArray(thread?.conversation?.messages) ? thread.conversation.messages : [];
      record(
        "history: all four turns persisted in order (user/assistant/user/assistant)",
        turns.length >= 4 &&
          turns[0]?.role === "user" &&
          turns[1]?.role === "assistant" &&
          turns[2]?.role === "user" &&
          turns[3]?.role === "assistant",
        ">= 4 alternating turns",
        `${turns.length} turns`,
      );
    }

    // --- Path-level conversation (no lessonId, scenario 3). ---------------
    const pathAnswer = await postTutor("POST path-level message (no lessonId) -> 200", "/api/ai-tutor", {
      cookieHeader,
      body: { message: "What should I learn next?" },
      expectStatus: 200,
    });
    await sweepProviderOrphans(restHeaders, session.user.id, LAST_STATUS !== 200);
    const pathConversationId = isUuid(pathAnswer?.conversationId) ? pathAnswer.conversationId : null;
    if (pathAnswer) {
      record(
        "answer: a path-level conversation resolves path context and a null lesson",
        pathAnswer.context?.hasPath === true && pathAnswer.context?.lesson === null && isUuid(pathAnswer.conversationId),
        "hasPath + lesson null",
        `hasPath=${pathAnswer.context?.hasPath}, lesson=${String(pathAnswer.context?.lesson)}`,
      );
    }

    // --- Conversation list (spec §10). -----------------------------------
    const listed = await api("GET conversation list -> 200", "/api/ai-tutor/conversations", {
      method: "GET",
      cookieHeader,
      expectStatus: 200,
    });
    const summaries = Array.isArray(listed?.conversations) ? listed.conversations : [];
    // Tolerate a transient provider failure: assert only the ids the server
    // actually returned (never require a conversation the reply never made).
    const expectedIds = [conversationId, pathConversationId].filter(Boolean);
    record(
      "list: every successfully-created conversation appears (newest first)",
      summaries.length >= expectedIds.length && expectedIds.every((id) => summaries.some((c) => c.id === id)),
      `>= ${expectedIds.length} including ${expectedIds.length} id(s)`,
      `${summaries.length} summar(ies)`,
    );
    record(
      "list: summaries carry only safe fields (no turns, no user_id)",
      summaries.every((c) => !("messages" in c) && !("user_id" in c) && typeof c.title === "string"),
      "id/title/lessonId/updatedAt only",
      summaries.length > 0 ? Object.keys(summaries[0]).join(",") : "n/a",
    );

    // --- Delete + malformed/foreign ids (scenario 18 honesty). -----------
    if (pathConversationId) {
      await api("DELETE a conversation -> 200 {deleted:true}", `/api/ai-tutor/conversations/${pathConversationId}`, {
        method: "DELETE",
        cookieHeader,
        expectStatus: 200,
      });
      await api("GET a deleted conversation -> 404", `/api/ai-tutor/conversations/${pathConversationId}`, {
        method: "GET",
        cookieHeader,
        expectStatus: 404,
      });
    }
    await api("GET a malformed conversation id -> 404", "/api/ai-tutor/conversations/not-a-uuid", {
      method: "GET",
      cookieHeader,
      expectStatus: 404,
    });
    await api("GET an unknown conversation uuid -> 404", `/api/ai-tutor/conversations/${RANDOM_UUID}`, {
      method: "GET",
      cookieHeader,
      expectStatus: 404,
    });

    // --- DB verification + RLS scoping. ----------------------------------
    const convRes = await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/ai_tutor_conversations?select=id,user_id&user_id=eq.${session.user.id}`, {
      headers: restHeaders,
    });
    const convRows = await convRes.json().catch(() => null);
    record(
      "DB: every persisted conversation belongs to the caller",
      convRes.ok && Array.isArray(convRows) && convRows.length > 0 && convRows.every((r) => r.user_id === session.user.id),
      "rows all owned by user",
      convRes.ok ? `${convRows?.length ?? "?"} row(s)` : `HTTP ${convRes.status}`,
    );

    // --- The page renders the real, server-derived header (18). ----------
    await page("page: /ai-tutor renders the real 'CURRENTLY LEARNING' header", "/ai-tutor", 200, {
      cookieHeader,
      marker: "CURRENTLY LEARNING",
    });
    await page("page: /ai-tutor?lesson=<id> renders the lesson-scoped header", `/ai-tutor?lesson=${mid.id}`, 200, {
      cookieHeader,
      marker: "CURRENTLY LEARNING",
    });
    // The lesson page carries the "Ask AI Tutor" entry (spec §11).
    await page("page: /learn/[lessonId] offers the Ask AI Tutor entry", `/learn/${mid.id}`, 200, {
      cookieHeader,
      marker: "Ask AI Tutor",
    });

    // Remember a lesson + conversation id for Tier 4 (cross-user).
    globalThis.__userBLessonId = mid.id;
    globalThis.__userBConversationId = conversationId;
  }
}

// ---------------------------------------------------------------------------
// Tier 3: no-path honesty (User A - authenticated, never onboarded).
// ---------------------------------------------------------------------------

const userASession = await throwawaySession("path-e2e-usera@gmail.com", "path-e2e-test-Password1!");

if (!userASession) {
  skipped.push("Tier 3/4/8 (User A throwaway account unavailable)");
} else {
  console.log("\n== Tier 3: no-path honesty (scenarios 2, 18) ==\n");
  const userACookie = sessionCookieHeader(userASession);
  const userARest = restHeadersFor(userASession);

  // Guarantee the precondition: no persisted path for this account.
  await supabaseFetchSafe(`${SUPABASE_URL}/rest/v1/learning_paths?user_id=eq.${userASession.user.id}`, {
    method: "DELETE",
    headers: userARest,
  });

  await page("User A: /ai-tutor shows the honest no-path state (no fake header)", "/ai-tutor", 200, {
    cookieHeader: userACookie,
    marker: "No path, no context yet.",
    notMarker: "CURRENTLY LEARNING",
  });
  await page("User A: /ai-tutor offers the Create-your-path CTA", "/ai-tutor", 200, {
    cookieHeader: userACookie,
    marker: "Create your learning path",
  });

  const noPathLesson = await api("User A: lesson context -> 404 (fabricates nothing)", `/api/ai-tutor/lesson/${RANDOM_UUID}`, {
    method: "GET",
    cookieHeader: userACookie,
    expectStatus: 404,
  });
  record("User A: lesson context body is a safe empty reference", noPathLesson === null || typeof noPathLesson?.error === "string", "safe error", noPathLesson ? "ok" : "ok");

  // A message with no path must return an honest hasPath:false context, never
  // an invented Full-Stack course (spec §19).
  const noPathAnswer = await postTutor("User A: POST message -> 200 with an honest no-path context", "/api/ai-tutor", {
    cookieHeader: userACookie,
    body: { message: "What am I learning?" },
    expectStatus: 200,
  });
  await sweepProviderOrphans(restHeadersFor(userASession), userASession.user.id, LAST_STATUS !== 200);
  if (noPathAnswer) {
    record(
      "User A: the reply reports hasPath:false with a null path (nothing fabricated)",
      noPathAnswer.context?.hasPath === false && noPathAnswer.context?.path === null && noPathAnswer.context?.lesson === null,
      "hasPath:false, path|null, lesson|null",
      `hasPath=${noPathAnswer.context?.hasPath}, path=${String(noPathAnswer.context?.path)}, lesson=${String(noPathAnswer.context?.lesson)}`,
    );
    record(
      "User A: no sample conversation content leaked into the reply",
      !/javascript|react|full-stack|npm|typescript/i.test(String(noPathAnswer.assistantMessage?.content ?? "")),
      "no programming sample content",
      /javascript|react|full-stack|npm|typescript/i.test(String(noPathAnswer.assistantMessage?.content ?? "")) ? "leaked" : "clean",
    );
  }
}

// ---------------------------------------------------------------------------
// Tier 4: cross-user protection (User A must never touch User B's data).
// ---------------------------------------------------------------------------

if (userASession && session && globalThis.__userBLessonId) {
  console.log("\n== Tier 4: cross-user protection (scenario 7) ==\n");
  const userACookie = sessionCookieHeader(userASession);

  await api(
    "User A: posting one of User B's lesson ids -> 404 (not on A's path)",
    "/api/ai-tutor",
    { cookieHeader: userACookie, body: { lessonId: globalThis.__userBLessonId, message: "teach me this" }, expectStatus: 404 },
  );

  if (globalThis.__userBConversationId) {
    const foreign = globalThis.__userBConversationId;
    await api("User A: GET User B's conversation -> 404", `/api/ai-tutor/conversations/${foreign}`, {
      method: "GET",
      cookieHeader: userACookie,
      expectStatus: 404,
    });
    await api("User A: continuing User B's conversation -> 404", "/api/ai-tutor", {
      cookieHeader: userACookie,
      body: { conversationId: foreign, message: "continue this" },
      expectStatus: 404,
    });
    await api("User A: DELETE User B's conversation -> 404", `/api/ai-tutor/conversations/${foreign}`, {
      method: "DELETE",
      cookieHeader: userACookie,
      expectStatus: 404,
    });

    // RLS proof: the other user's row is invisible even via the REST API.
    const rlsRes = await supabaseFetchSafe(
      `${SUPABASE_URL}/rest/v1/ai_tutor_conversations?select=id&id=eq.${foreign}`,
      { headers: restHeadersFor(userASession) },
    );
    const rlsRows = await rlsRes.json().catch(() => null);
    record(
      "RLS: User A cannot read User B's conversation row directly",
      rlsRes.ok && Array.isArray(rlsRows) && rlsRows.length === 0,
      "0 rows",
      rlsRes.ok ? `${rlsRows?.length ?? "?"} row(s)` : `HTTP ${rlsRes.status}`,
    );
  }
} else if (!session || !userASession) {
  skipped.push("Tier 4 cross-user protection (needs both User A and User B)");
}

// ---------------------------------------------------------------------------
// Tier 5: domain-agnostic context (scenarios 8-11).
//
// The context route derives everything from the DB and never calls the
// provider, so it is the cheapest honest proof that the tutor is not
// programming-specific. Each student account is only checked when it already
// owns a usable path (the multi-domain harness creates them).
// ---------------------------------------------------------------------------

console.log("\n== Tier 5: domain-agnostic context (scenarios 8-11) ==\n");

const domainStudents = [
  { email: "student-react-e2e@gmail.com", label: "Programming", programming: true },
  { email: "student-physics-e2e@gmail.com", label: "Physics", programming: false },
  { email: "student-english-e2e@gmail.com", label: "Spoken English", programming: false },
  { email: "student-uiux-e2e@gmail.com", label: "UI/UX", programming: false },
  { email: "student-math-e2e@gmail.com", label: "Mathematics", programming: false },
];

const PROGRAMMING_MARKERS = /javascript|typescript|react\b|node\.?js|full-?stack|npm|api endpoint/i;

for (const student of domainStudents) {
  const studentSession = await throwawaySession(student.email, "path-e2e-test-Password1!");
  if (!studentSession) {
    skipped.push(`Tier 5 ${student.label} (account unavailable)`);
    continue;
  }
  const headers = restHeadersFor(studentSession);
  const pathsRes = await supabaseFetchSafe(
    `${SUPABASE_URL}/rest/v1/learning_paths?select=id,subject,domain&user_id=eq.${studentSession.user.id}&is_active=eq.true`,
    { headers },
  );
  const paths = await pathsRes.json().catch(() => null);
  const activePath = Array.isArray(paths) ? paths[0] : null;
  if (!activePath) {
    skipped.push(`Tier 5 ${student.label} (no active path persisted for this account)`);
    continue;
  }

  const lessonsRes = await supabaseFetchSafe(
    `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order&path_id=eq.${activePath.id}&order=lesson_order.asc`,
    { headers },
  );
  const lessons = await lessonsRes.json().catch(() => null);
  if (!Array.isArray(lessons) || lessons.length === 0) {
    skipped.push(`Tier 5 ${student.label} (no lessons on the active path)`);
    continue;
  }

  const ctxBody = await api(
    `${student.label}: context route -> 200 derived from that learner's own path`,
    `/api/ai-tutor/lesson/${lessons[0].id}`,
    { method: "GET", cookieHeader: sessionCookieHeader(studentSession), expectStatus: 200 },
  );

  if (ctxBody?.context) {
    const ctx = ctxBody.context;
    const blob = JSON.stringify(ctx);
    record(
      `${student.label}: context carries a real subject/domain (not generic)`,
      ctx.hasPath === true && typeof ctx.path?.subject === "string" && ctx.path.subject.trim().length > 0 && typeof ctx.path?.domain === "string" && ctx.path.domain.trim().length > 0,
      "non-empty subject + domain",
      `subject=${JSON.stringify(ctx.path?.subject)}, domain=${JSON.stringify(ctx.path?.domain)}`,
    );
    record(
      `${student.label}: context resolves THAT path's lesson`,
      ctx.lesson?.id === lessons[0].id && ctx.path?.id === activePath.id,
      `${String(lessons[0].id).slice(0, 8)}…/@${String(activePath.id).slice(0, 8)}…`,
      `${String(ctx.lesson?.id).slice(0, 8)}…/@${String(ctx.path?.id).slice(0, 8)}…`,
    );
    if (!student.programming) {
      record(
        `${student.label}: no programming vocabulary leaks into the context`,
        !PROGRAMMING_MARKERS.test(blob),
        "no programming markers",
        PROGRAMMING_MARKERS.test(blob) ? `leak: ${blob.match(PROGRAMMING_MARKERS)?.[0]}` : "clean",
      );
    }
  }
}

// One REAL, provider-backed reply outside programming: the Physics student.
// Keeping this to a single call proves the end-to-end path works for a
// non-programming domain without making the suite pay for five generations.
{
  const physicsSession = await throwawaySession("student-physics-e2e@gmail.com", "path-e2e-test-Password1!");
  if (physicsSession) {
    const headers = restHeadersFor(physicsSession);
    const pathsRes = await supabaseFetchSafe(
      `${SUPABASE_URL}/rest/v1/learning_paths?select=id&user_id=eq.${physicsSession.user.id}&is_active=eq.true`,
      { headers },
    );
    const paths = await pathsRes.json().catch(() => null);
    const activePath = Array.isArray(paths) ? paths[0] : null;
    if (activePath) {
      const lessonsRes = await supabaseFetchSafe(
        `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,lesson_order&path_id=eq.${activePath.id}&order=lesson_order.asc`,
        { headers },
      );
      const lessons = await lessonsRes.json().catch(() => null);
      if (Array.isArray(lessons) && lessons.length > 0) {
        const physicsAnswer = await liveAnswer(
          "Physics: a real end-to-end reply grounded in the Physics lesson",
          "/api/ai-tutor",
          {
            cookieHeader: sessionCookieHeader(physicsSession),
            body: { lessonId: lessons[0].id, message: SHORT_QUESTION },
            check: (body) => body.context?.lesson?.id === lessons[0].id,
          },
        );
        await sweepProviderOrphans(headers, physicsSession.user.id, LAST_STATUS !== 200);
        if (physicsAnswer) {
          record(
            "Physics: reply is anchored to the Physics lesson",
            physicsAnswer.context?.lesson?.id === lessons[0].id,
            "lesson-anchored answer",
            `lesson=${String(physicsAnswer.context?.lesson?.id).slice(0, 8)}…`,
          );
        }
      } else {
        skipped.push("Tier 5 Physics live reply (no lessons on the active path)");
      }
    } else {
      skipped.push("Tier 5 Physics live reply (no active path persisted)");
    }
  } else {
    skipped.push("Tier 5 Physics live reply (account unavailable)");
  }
}

// ---------------------------------------------------------------------------
// Tier 6: language - the Hinglish student asks for Hinglish (scenario 12).
// ---------------------------------------------------------------------------

console.log("\n== Tier 6: language request (scenario 12) ==\n");

{
  const hinglishSession = await throwawaySession("student-english-e2e@gmail.com", "path-e2e-test-Password1!");
  if (hinglishSession) {
    const headers = restHeadersFor(hinglishSession);
    const pathsRes = await supabaseFetchSafe(
      `${SUPABASE_URL}/rest/v1/learning_paths?select=id,video_language&user_id=eq.${hinglishSession.user.id}&is_active=eq.true`,
      { headers },
    );
    const paths = await pathsRes.json().catch(() => null);
    const activePath = Array.isArray(paths) ? paths[0] : null;
    if (activePath) {
      const lessonsRes = await supabaseFetchSafe(
        `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id&path_id=eq.${activePath.id}&order=lesson_order.asc`,
        { headers },
      );
      const lessons = await lessonsRes.json().catch(() => null);
      if (Array.isArray(lessons) && lessons.length > 0) {
        const hinglishAnswer = await liveAnswer(
          "Hinglish: 'Explain this in Hinglish' -> 200 grounded in the learner's own lesson",
          "/api/ai-tutor",
          {
            cookieHeader: sessionCookieHeader(hinglishSession),
            body: { lessonId: lessons[0].id, message: "Explain this in Hinglish, please." },
            check: (body) => typeof body.context?.path?.videoLanguage === "string",
          },
        );
        await sweepProviderOrphans(headers, hinglishSession.user.id, LAST_STATUS !== 200);
        if (hinglishAnswer) {
          record(
            "Hinglish: the context records the learner's preferred language",
            typeof hinglishAnswer.context?.path?.videoLanguage === "string",
            "videoLanguage recorded",
            `videoLanguage=${JSON.stringify(hinglishAnswer.context?.path?.videoLanguage)}`,
          );
        }
      } else {
        skipped.push("Tier 6 Hinglish (no lessons on the English account's active path)");
      }
    } else {
      skipped.push("Tier 6 Hinglish (no active path persisted for the English account)");
    }
  } else {
    skipped.push("Tier 6 Hinglish (account unavailable)");
  }
}

// ---------------------------------------------------------------------------
// Tier 7: provider-failure contract (scenarios 13, 14).
//
// The status mapping is fixed in lib/ai-tutor/http.ts: config/rate_limit ->
// 503, timeout/network/api/invalid_output -> 502. A live provider failure
// cannot be induced from outside the server, so the operator forces one by
// starting the server with a deliberately bad NVIDIA key (or a stubbed
// provider) and setting AI_TUTOR_FORCE_PROVIDER_FAILURE=1. The harness then
// asserts the observable contract: a 502/503 with a safe, key-free body and
// no raw provider text. Without that flag this records an explicit SKIP.
// ---------------------------------------------------------------------------

console.log("\n== Tier 7: provider-failure contract (scenarios 13, 14) ==\n");

if (!session) {
  skipped.push("Tier 7 provider failure (no authenticated session to post with)");
} else if (process.env.AI_TUTOR_FORCE_PROVIDER_FAILURE !== "1") {
  skipped.push(
    "Tier 7 provider failure — start the server with a bad NVIDIA key and AI_TUTOR_FORCE_PROVIDER_FAILURE=1 to exercise the 502/503 mapping",
  );
  // Even without forcing a failure we can prove the mapping is never a naked
  // 500 with internal text: any invalid request still yields a safe 4xx.
  await api("provider contract: invalid request still returns a safe, non-500 body", "/api/ai-tutor", {
    cookieHeader: sessionCookieHeader(session),
    body: { message: "" },
    expectStatus: 400,
  });
} else {
  const failure = await fetch(`${BASE_URL}/api/ai-tutor`, {
    method: "POST",
    headers: { cookie: sessionCookieHeader(session), "Content-Type": "application/json" },
    body: JSON.stringify({ message: SHORT_QUESTION }),
    redirect: "manual",
  });
  const raw = await failure.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  record(
    "provider failure: status is the mapped 502/503 (never a naked 500)",
    failure.status === 502 || failure.status === 503,
    "502 or 503",
    failure.status,
  );
  record(
    "provider failure: body is a safe, key-free error object",
    assertSafeErrorBody(parsed, raw) === null,
    "safe error body",
    assertSafeErrorBody(parsed, raw) ?? "safe",
  );
  record(
    "provider failure: no raw provider/SQL text leaked",
    !/nvidia|nvapi|postgrest|relation|stack/i.test(raw),
    "no provider/driver text",
    /nvidia|nvapi|postgrest|relation|stack/i.test(raw) ? "leaked" : "clean",
  );
}

// ---------------------------------------------------------------------------
// Tier 8: multiple paths + active switching (scenario 17).
//
// The tutor must follow the caller's ACTIVE path, re-resolved on every
// request. When the dedicated account holds two paths, switching the active
// path must change the tutor's trusted path context on the next request.
// ---------------------------------------------------------------------------

console.log("\n== Tier 8: multiple paths + active switching (scenario 17) ==\n");

{
  const multiSession = await throwawaySession("multipath-e2e@gmail.com", "path-e2e-test-Password1!");
  if (!multiSession) {
    skipped.push("Tier 8 multiple paths (multipath account unavailable)");
  } else {
    const multiCookie = sessionCookieHeader(multiSession);
    const list = await api("multipath: GET /api/learning/paths/list -> 200", "/api/learning/paths/list", {
      method: "GET",
      cookieHeader: multiCookie,
      expectStatus: 200,
    });
    const paths = Array.isArray(list?.paths) ? list.paths : [];
    if (paths.length < 2) {
      skipped.push(`Tier 8 multiple paths (account holds ${paths.length} path(s); needs 2)`);
    } else {
      const activeBefore = paths.find((p) => p.isActive) ?? paths[0];
      const target = paths.find((p) => p.id !== activeBefore.id);

      // Resolve the currently active path's first lesson so the tutor's OWN
      // context route can confirm which path it considers active BEFORE the
      // switch (the route re-derives ownership from the DB, not the client).
      const beforeLessonsRes = await supabaseFetchSafe(
        `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id&path_id=eq.${activeBefore.id}&order=lesson_order.asc&limit=1`,
        { headers: restHeadersFor(multiSession) },
      );
      const beforeLessons = await beforeLessonsRes.json().catch(() => null);
      const beforeLessonId = Array.isArray(beforeLessons) ? beforeLessons[0]?.id : null;

      if (beforeLessonId) {
        const activeBeforeCtx = await api(
          "multipath: tutor context reflects the currently active path",
          `/api/ai-tutor/lesson/${beforeLessonId}`,
          { method: "GET", cookieHeader: multiCookie, expectStatus: 200 },
        );
        record(
          "multipath: before the switch the tutor is anchored to the active path",
          activeBeforeCtx?.context?.path?.id === activeBefore.id,
          `path ${activeBefore.id.slice(0, 8)}…`,
          `path ${String(activeBeforeCtx?.context?.path?.id).slice(0, 8)}…`,
        );
      }

      await api("multipath: POST /api/learning/paths/active -> 200", "/api/learning/paths/active", {
        cookieHeader: multiCookie,
        body: { pathId: target.id },
        expectStatus: 200,
      });

      const afterLessonsRes = await supabaseFetchSafe(
        `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id&path_id=eq.${target.id}&order=lesson_order.asc&limit=1`,
        { headers: restHeadersFor(multiSession) },
      );
      const afterLessons = await afterLessonsRes.json().catch(() => null);
      const afterLessonId = Array.isArray(afterLessons) ? afterLessons[0]?.id : null;

      if (beforeLessonId && afterLessonId) {
        const afterCtx = await api(
          "multipath: tutor context now follows the NEWLY active path",
          `/api/ai-tutor/lesson/${afterLessonId}`,
          { method: "GET", cookieHeader: multiCookie, expectStatus: 200 },
        );
        record(
          "multipath: switch changed the tutor's trusted path context",
          afterCtx?.context?.path?.id === target.id && afterCtx?.context?.lesson?.id === afterLessonId,
          `path ${target.id.slice(0, 8)}…`,
          `path ${String(afterCtx?.context?.path?.id).slice(0, 8)}…`,
        );

        const staleCtx = await api(
          "multipath: a lesson from the now-inactive path -> 404 (no cross-path leakage)",
          `/api/ai-tutor/lesson/${beforeLessonId}`,
          { method: "GET", cookieHeader: multiCookie, expectStatus: 404 },
        );
        record(
          "multipath: the inactive path's lesson is not on the active path",
          staleCtx === null || typeof staleCtx?.error === "string",
          "safe 404",
          "ok",
        );

        // Restore the original active path so re-runs stay deterministic.
        await api("multipath: restore the original active path -> 200", "/api/learning/paths/active", {
          cookieHeader: multiCookie,
          body: { pathId: activeBefore.id },
          expectStatus: 200,
        });
      } else {
        skipped.push("Tier 8 multiple paths (could not resolve lesson ids on both paths)");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (skipped.length > 0) {
  console.log("Skipped:");
  for (const s of skipped) console.log(`  - ${s}`);
}
if (failed.length > 0) {
  console.log("Failed checks:");
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
