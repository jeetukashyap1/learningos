/**
 * Diagnostics for the YouTube learning feature. Never prints the API key.
 * Part 1: probes search.list with the exact params lib/youtube/client.ts
 *         builds and prints the raw error body on failure.
 * Part 2: fetches /skills and /learn/[lessonId] with a signed-in session and
 *         reports which YouTube-related markers appear in the SSR HTML.
 *
 * Usage: node scripts/debug-youtube.mjs [baseUrl]
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
const KEY = env.YOUTUBE_API_KEY;

// --- Part 1: direct search.list probe -------------------------------------
if (KEY) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  const params = {
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    maxResults: "6",
    q: "REST API",
    key: KEY,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  console.log("== search.list probe ==");
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    console.log(`HTTP ${res.status}`);
    if (res.ok) {
      const body = await res.json();
      console.log(`items: ${body.items?.length ?? 0}`);
    } else {
      console.log((await res.text()).slice(0, 600));
    }
  } catch (error) {
    console.log(`fetch error: ${error.message}`);
  }
} else {
  console.log("== search.list probe skipped (no key) ==");
}

// --- Part 2: SSR HTML markers ----------------------------------------------
console.log("\n== SSR HTML markers ==");

const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: ANON_KEY },
  body: JSON.stringify({ email: "yt-route-test-user@gmail.com", password: "yt-route-test-Password1!" }),
});
const session = await signinRes.json().catch(() => null);
if (!signinRes.ok || !session?.access_token) {
  console.log("sign-in failed; cannot check pages");
  process.exit(0);
}

const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const cookieName = `sb-${projectRef}-auth-token`;
const encoded = encodeURIComponent(JSON.stringify(session));
const chunks = [];
for (let i = 0; i * 3180 < encoded.length; i += 1) {
  chunks.push(encoded.slice(i * 3180, (i + 1) * 3180));
}
const cookieHeader = chunks
  .map((chunk, i) => (chunks.length === 1 ? `${cookieName}=${chunk}` : `${cookieName}.${i}=${chunk}`))
  .join("; ");

for (const [label, path, outFile] of [
  ["/skills", "/skills", "debug-skills.html"],
  ["/learn/rest-methods", "/learn/rest-methods", "debug-learn.html"],
]) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { cookie: cookieHeader }, redirect: "manual" });
  const html = await res.text();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outFile, html, "utf8");
  console.log(`\n${label}: HTTP ${res.status}, ${html.length} bytes (dumped to ${outFile})`);
  for (const marker of [
    "Learn it on YouTube",
    "learning-resources-title",
    "Searching YouTube",
    "learning-resources",
    "YouTube",
    "youtube",
    "/api/learning/youtube/search",
    "_next/static/chunks",
  ]) {
    const idx = html.indexOf(marker);
    console.log(`  ${idx >= 0 ? `FOUND @ ${idx}` : "absent "} : ${JSON.stringify(marker)}`);
  }
}
