/**
 * Runtime test harness for GET /api/learning/youtube/search.
 *
 * Tier 1 (always runs, no credentials needed):
 *   - Unauthenticated API calls must return 401 with a safe message (auth
 *     runs before validation, before any key access).
 *   - Forged/tampered session cookies (garbage value, fake access token,
 *     wrong project cookie name) must return 401, never 500, and must not
 *     leak keys or internal details. getUser() revalidates with the Supabase
 *     server, so a well-formed but fake JWT must still fail.
 *   - Middleware protection is intact: unauthenticated visits to protected
 *     pages 307-redirect to /login?next=<path>, /login renders, and public
 *     routes are untouched.
 *
 * Tier 2 (requires credentials of a confirmed account on the Supabase
 * project, passed via env vars so they never need to be hardcoded):
 *   TEST_EMAIL + TEST_PASSWORD  -> password grant sign-in, then:
 *   - Full validation battery on the API (400s), config error (503 when no
 *     YOUTUBE_API_KEY is configured), or a fully validated 200 response when
 *     a key is present (shape, 11-char video IDs, ranking order, dedup).
 *   - Protected pages render 200 with the integration marker
 *     ("Learn it on YouTube"), frozen pages still render, /login bounces a
 *     signed-in user to /dashboard.
 *
 * Usage: node scripts/test-youtube-route.mjs [baseUrl]
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (and
 * optionally YOUTUBE_API_KEY for expectations) from .env.local.
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

const HAS_YOUTUBE_KEY = Boolean(env.YOUTUBE_API_KEY);
// FORCE_EXPECT overrides the 200/503 expectation so the same battery can
// verify the config-error path (server started without a key) or the
// upstream-error path (server started with a deliberately broken key).
const EXPECT_VALID = Number(process.env.FORCE_EXPECT) || (HAS_YOUTUBE_KEY ? 200 : 503);

const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const cookieName = `sb-${projectRef}-auth-token`;

const results = [];
const skipped = [];

function record(name, pass, expected, got, detail = "") {
  results.push({ name, expected, got, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: expected ${expected}, got ${got}${detail ? ` — ${detail}` : ""}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

/** Asserts a JSON error body is safe: string error, no secret leakage. */
function assertSafeErrorBody(body, raw) {
  if (!body || typeof body.error !== "string" || body.error.length === 0) {
    return "body is not a safe error object";
  }
  const text = raw ?? JSON.stringify(body);
  if (env.YOUTUBE_API_KEY && text.includes(env.YOUTUBE_API_KEY)) {
    return "body leaks the YouTube API key";
  }
  if (text.includes("SUPABASE_SERVICE_ROLE") || text.includes("service_role")) {
    return "body mentions service-role material";
  }
  return null;
}

async function call(name, search, expectStatus, cookieHeader) {
  try {
    const res = await fetch(`${BASE_URL}/api/learning/youtube/search${search}`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      redirect: "manual",
    });
    const raw = await res.text();
    const body = raw ? JSON.parse(raw) : null;

    if (res.status >= 400) {
      const unsafe = assertSafeErrorBody(body, raw);
      record(name, res.status === expectStatus && !unsafe, expectStatus, res.status, unsafe ?? undefined);
      return body;
    }

    // 200 expectations: validate normalized response shape.
    let problem = null;
    if (res.status === 200) {
      if (!Array.isArray(body?.results)) problem = "results is not an array";
      else if (typeof body?.cached !== "boolean") problem = "cached is not a boolean";
      else {
        const ids = body.results.map((item) => item?.externalId);
        if (ids.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id))) {
          problem = "some externalId is not a canonical 11-char YouTube video id";
        } else if (new Set(ids).size !== ids.length) {
          problem = "duplicate youtubeVideoId in results (dedup failed)";
        } else if (body.results.some((item) => !/^https:\/\/www\.youtube\.com\/watch\?v=/.test(item?.url ?? ""))) {
          problem = "some url is not a canonical watch URL";
        } else if (body.results.some((item) => typeof item?.relevanceScore !== "number")) {
          problem = "some relevanceScore is missing";
        } else {
          const scores = body.results.map((item) => item.relevanceScore);
          for (let i = 1; i < scores.length; i += 1) {
            if (scores[i] > scores[i - 1]) problem = "results not ordered by descending relevanceScore";
          }
        }
      }
    }
    record(name, res.status === expectStatus && !problem, expectStatus, res.status, problem ?? undefined);
    return body;
  } catch (error) {
    record(name, false, expectStatus, `fetch error: ${error.message}`);
    return null;
  }
}

async function page(name, path, expectStatus, { cookieHeader, marker, redirectIncludes } = {}) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      redirect: "manual",
    });
    const location = res.headers.get("location") ?? "";
    let problem = null;
    if (redirectIncludes && !decodeURIComponent(location).includes(redirectIncludes)) {
      problem = `Location "${location}" does not include ${redirectIncludes}`;
    }
    if (res.status === 200 && marker) {
      const html = await res.text();
      if (!html.includes(marker)) problem = `page does not include marker "${marker}"`;
    }
    record(name, res.status === expectStatus && !problem, expectStatus, res.status, problem ?? undefined);
  } catch (error) {
    record(name, false, expectStatus, `fetch error: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tier 1a: unauthenticated API access must 401 with a safe message.
// ---------------------------------------------------------------------------
console.log(`\n== Tier 1: credential-free security tests (${HAS_YOUTUBE_KEY ? "key present" : "no YOUTUBE_API_KEY"}) ==\n`);
await call("no cookie, valid query -> 401", "?query=REST%20API", 401);
await call("no cookie, empty query -> 401 (auth before validation)", "?query=", 401);
await call("no cookie, invalid params -> 401 (auth before validation)", "?query=x&level=expert", 401);

// ---------------------------------------------------------------------------
// Tier 1b: forged session cookies must 401, never 500, never leak.
// ---------------------------------------------------------------------------
const fakeSession = {
  access_token: "fake-access-token",
  refresh_token: "fake-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated" },
};
await call("garbage cookie value -> 401", "?query=REST%20API", 401, `${cookieName}=this-is-not-uri-encoded-json`);
await call(
  "well-formed fake session cookie -> 401 (server revalidates)",
  "?query=REST%20API",
  401,
  `${cookieName}=${encodeURIComponent(JSON.stringify(fakeSession))}`,
);
await call(
  "wrong project cookie name -> 401",
  "?query=REST%20API",
  401,
  `sb-not-the-real-project-auth-token=${encodeURIComponent(JSON.stringify(fakeSession))}`,
);

// ---------------------------------------------------------------------------
// Tier 1c: middleware protection + public routes intact (unauthenticated).
// ---------------------------------------------------------------------------
await page("unauth /learn/[lessonId] -> 307 to login", "/learn/rest-methods", 307, {
  redirectIncludes: "/login?next=/learn/rest-methods",
});
await page("unauth /skills -> 307 to login", "/skills", 307, { redirectIncludes: "/login?next=/skills" });
await page("unauth /dashboard -> 307 to login", "/dashboard", 307, { redirectIncludes: "/login" });
await page("unauth /journey -> 307 to login", "/journey", 307, { redirectIncludes: "/login" });
await page("unauth /practice -> 307 to login", "/practice", 307, { redirectIncludes: "/login" });
await page("unauth /quick-learn -> 307 to login", "/quick-learn", 307, { redirectIncludes: "/login" });
await page("unauth /progress -> 307 to login", "/progress", 307, { redirectIncludes: "/login" });
await page("unauth /projects -> 307 to login", "/projects", 307, { redirectIncludes: "/login" });
await page("unauth /api route does not redirect (401 json, not a loop)", "/api/learning/youtube/search?query=x", 401);
await page("/login renders for signed-out users", "/login", 200, { marker: "auth-panel" });
await page("landing page still renders", "/", 200, { marker: "landing" });

// ---------------------------------------------------------------------------
// Tier 2: authenticated battery (needs TEST_EMAIL / TEST_PASSWORD of a
// confirmed account; opportunistic anonymous sign-in is tried first).
// ---------------------------------------------------------------------------
let session = null;

if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
  const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
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
} else {
  // Opportunistic attempts that need no secrets from the user:
  //   1. Anonymous sign-in (POST /auth/v1/signup with no body) returns a
  //      session immediately when the provider is enabled.
  //   2. Email sign-up returns a session immediately when email confirmation
  //      is disabled on the project; a throwaway address is used so no real
  //      inbox is involved.
  const anonRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({}),
  });
  const anonBody = await anonRes.json().catch(() => null);
  if (anonRes.ok && anonBody?.session?.access_token) {
    session = anonBody.session;
    console.log("[setup] anonymous session created");
  } else if (anonRes.status === 429) {
    console.log("[setup] anonymous attempt rate-limited (429)");
  }

  if (!session) {
    // Fixed address: once this account is confirmed once (Supabase dashboard
    // -> Authentication -> Users -> select it -> "Confirm email", or via the
    // emailed link), the password grant below succeeds on every future run.
    const email = "yt-route-test-user@gmail.com";
    const password = "yt-route-test-Password1!";
    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
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
      // The account exists (or was just created); if it has been confirmed
      // in the dashboard, the password grant works.
      const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
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
}

if (!session) {
  skipped.push("authenticated API battery (needs TEST_EMAIL + TEST_PASSWORD env vars of a confirmed account)");
  skipped.push("authenticated page render checks (same requirement)");
} else {
  console.log("\n== Tier 2: authenticated tests ==\n");

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

  await call("valid query -> 200 (or 503 config when key missing)", "?query=REST%20API&topic=APIs&level=intermediate", EXPECT_VALID, cookieHeader);
  await call("empty query -> 400", "?query=", 400, cookieHeader);
  await call("short query -> 400", "?query=a", 400, cookieHeader);
  await call("long query -> 400", `?query=${"a".repeat(121)}`, 400, cookieHeader);
  await call("invalid level -> 400", "?query=REST%20API&level=expert", 400, cookieHeader);
  await call("invalid duration -> 400", "?query=REST%20API&duration=huge", 400, cookieHeader);
  await call("zero limit -> 400", "?query=REST%20API&limit=0", 400, cookieHeader);
  await call("invalid language -> 400", "?query=REST%20API&language=not-a-code!!", 400, cookieHeader);
  await call("duplicate query param -> 400", "?query=REST&query=API", 400, cookieHeader);
  await call("missing query param -> 400", "?topic=APIs", 400, cookieHeader);
  await call("second valid query (error not cached) -> 503/200", "?query=JavaScript%20async%20await", EXPECT_VALID, cookieHeader);
  const obscure = await call("obscure query -> 200 (no-results path is safe)", "?query=qzwxecrv%20notopic%20xyzzyplugh", EXPECT_VALID, cookieHeader);
  if (obscure && Array.isArray(obscure.results)) {
    console.log(`      (obscure query returned ${obscure.results.length} result(s))`);
  }

  // Complete onboarding for the signed-in user (self-insert into
  // onboarding_profiles, exactly what the onboarding UI's upsert does; RLS
  // allows auth.uid() = user_id). This makes hasLearningPath true so /skills
  // renders its content branch including the LearningResources section.
  const onboardRes = await fetch(`${SUPABASE_URL}/rest/v1/onboarding_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: session.user.id,
      topic: "Web development",
      current_level: "building",
      daily_time: "30",
      goal_type: "career",
    }),
  });
  if (!onboardRes.ok) {
    console.log(`[setup] onboarding upsert failed (HTTP ${onboardRes.status}): ${(await onboardRes.text()).slice(0, 200)}`);
  } else {
    console.log("[setup] onboarding complete for test user (hasLearningPath -> true)");
  }

  // /learn content is gated by hasLearningHistory, which is honestly false
  // for every signed-in user in this phase (pre-existing app design — the
  // whole lesson viewer is gated the same way, not just the YouTube section).
  // The LearningResources integration there is verified in source and via the
  // identical component on /skills; here we verify the page renders its
  // honest empty state for a signed-in user.
  await page("/learn/[lessonId] renders honest empty state (pre-existing hasLearningHistory gate)", "/learn/rest-methods", 200, {
    cookieHeader,
    marker: "No lesson yet",
  });
  await page("/skills renders with YouTube section", "/skills", 200, {
    cookieHeader,
    marker: "Learn it on YouTube",
  });
  await page("sidebar navigation still present", "/dashboard", 200, {
    cookieHeader,
    marker: 'aria-label="Main navigation"',
  });
  await page("/journey renders", "/journey", 200, { cookieHeader, marker: "container" });
  await page("/practice renders", "/practice", 200, { cookieHeader, marker: "container" });
  await page("/quick-learn renders", "/quick-learn", 200, { cookieHeader, marker: "container" });
  await page("/progress renders", "/progress", 200, { cookieHeader, marker: "container" });
  await page("/projects renders", "/projects", 200, { cookieHeader, marker: "container" });
  await page("/login bounces signed-in user to /dashboard", "/login", 307, {
    cookieHeader,
    redirectIncludes: "/dashboard",
  });
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (skipped.length > 0) {
  console.log("Skipped (missing credentials):");
  for (const s of skipped) console.log(`  - ${s}`);
  console.log("To enable: TEST_EMAIL=<confirmed email> TEST_PASSWORD=<password> node scripts/test-youtube-route.mjs");
}
if (failed.length > 0) {
  console.log("Failed checks:");
  for (const f of failed) console.log(`  - ${f.name} (expected ${f.expected}, got ${f.got})`);
  process.exit(1);
}
