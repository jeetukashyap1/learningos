/**
 * Diagnostic for the Tier-2 E2E account: signs in and prints the latest
 * learning_path rows plus the modules/lessons of the newest path, so we can
 * verify what the generate route actually persisted - independent of what
 * the HTTP client observed (e.g. when the client aborted before the server
 * finished responding).
 *
 * Usage: node scripts/check-tier2-path.mjs
 * (honors TEST_EMAIL / TEST_PASSWORD, defaults to the Tier-2 E2E account)
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2];
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL ?? "path-e2e-tier2@learningos.test";
const PASSWORD = process.env.TEST_PASSWORD ?? "path-e2e-test-Password1!";

const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const auth = await authRes.json();
if (!authRes.ok) {
  console.log(`sign-in failed: ${authRes.status}`, JSON.stringify(auth));
  process.exit(1);
}
const token = auth.access_token;
const userId = auth.user?.id;
console.log(`signed in: ${EMAIL} (${userId})`);

const rest = { apikey: ANON_KEY, Authorization: `Bearer ${token}` };

const pathsRes = await fetch(
  `${SUPABASE_URL}/rest/v1/learning_paths?select=id,title,created_at,outcome_kind&order=created_at.desc&limit=3`,
  { headers: rest },
);
const paths = await pathsRes.json();
console.log(`learning_paths rows for this user: ${paths.length}`);
for (const row of paths) {
  console.log(
    ` - ${row.created_at} | outcome_kind=${JSON.stringify(row.outcome_kind)} | ${row.title} | ${row.id}`,
  );
}
const latest = paths[0];
if (!latest) {
  console.log("no path rows - generate did not persist anything for this user.");
  process.exit(0);
}

const modulesRes = await fetch(
  `${SUPABASE_URL}/rest/v1/learning_path_modules?select=id,order_index,title&path_id=eq.${latest.id}&order=order_index.asc`,
  { headers: rest },
);
const modules = await modulesRes.json();
console.log(`modules on latest path: ${modules.length}`);
for (const module of modules) {
  console.log(`   module ${module.order_index}: ${module.title}`);
}

const lessonsRes = await fetch(
  `${SUPABASE_URL}/rest/v1/learning_path_lessons?select=id,order_index,title,module_id&path_id=eq.${latest.id}&order=order_index.asc&limit=20`,
  { headers: rest },
);
const lessons = await lessonsRes.json();
const withModule = lessons.filter((lesson) => lesson.module_id).length;
console.log(`lessons on latest path: ${lessons.length} (with module_id: ${withModule})`);
