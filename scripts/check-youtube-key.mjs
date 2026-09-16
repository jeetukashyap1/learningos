/**
 * Validates the YOUTUBE_API_KEY from .env.local against the YouTube Data API
 * using the cheapest endpoint (videos.list with chart=mostPopular, 1 quota
 * unit). Prints only the outcome — the key itself is never echoed.
 *
 * Usage: node scripts/check-youtube-key.mjs
 */
import { readFile } from "node:fs/promises";

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
const key = env.YOUTUBE_API_KEY?.trim();
if (!key) {
  console.log("YOUTUBE_API_KEY: not set in .env.local (the route will return a 503 config error).");
  process.exit(0);
}

const url = new URL("https://www.googleapis.com/youtube/v3/videos");
url.searchParams.set("part", "id");
url.searchParams.set("chart", "mostPopular");
url.searchParams.set("maxResults", "1");
url.searchParams.set("key", key);

try {
  const res = await fetch(url);
  if (res.ok) {
    console.log(`YOUTUBE_API_KEY: valid (HTTP ${res.status}).`);
  } else {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "unknown";
    console.log(`YOUTUBE_API_KEY: rejected (HTTP ${res.status}, ${reason}).`);
  }
} catch (error) {
  console.log(`YOUTUBE_API_KEY: could not reach the YouTube Data API (${error.message}).`);
}
