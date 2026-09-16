/**
 * Verifies the learning-path migration (003) is applied to the live Supabase
 * project by probing each table through PostgREST with the anon key.
 *
 * A missing table comes back as HTTP 404 with code "PGRST205"; an existing
 * table returns 200 (empty array under RLS for anon). Also probes the tables
 * from migrations 001/002 so the report covers the full schema the
 * integration depends on.
 *
 * Usage: node scripts/check-db-tables.mjs
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local.
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

const TABLES = [
  { table: "profiles", migration: "001" },
  { table: "onboarding_profiles", migration: "001" },
  { table: "learning_resources", migration: "002" },
  { table: "learning_paths", migration: "003" },
  { table: "learning_path_lessons", migration: "003" },
];

let failed = 0;

/** Fetch with retry: one immediate retry on transient network errors. */
async function probe(url, headers) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

for (const { table, migration } of TABLES) {
  let status;
  let code = "";
  try {
    const response = await probe(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    });
    status = response.status;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      code = body.code ?? "";
    }
  } catch (error) {
    status = "network error";
    code = String(error);
  }

  // 200 = table exists (RLS hides rows from anon).
  // 401 + 42501 = "permission denied for table" — the table exists but anon
  //   has been fully revoked (every migration here does `revoke ... from anon`).
  // 404 + PGRST205 = not in the schema cache — the table does not exist.
  const exists = status === 200 || (status === 401 && code === "42501");
  const missing = status === 404 && code === "PGRST205";
  if (exists) {
    console.log(`PASS  ${table} (migration ${migration}) exists — HTTP ${status}${code ? ` ${code}` : ""}${status === 200 ? " (rows hidden by RLS)" : " (anon-locked)"}`);
  } else if (missing) {
    console.log(`FAIL  ${table} (migration ${migration}) is MISSING — HTTP ${status} ${code} (apply the migration in the Supabase SQL editor)`);
    failed += 1;
  } else {
    console.log(`WARN  ${table} (migration ${migration}) — HTTP ${status} ${code} (not the missing-table signature; check manually)`);
    failed += 1;
  }
}

console.log(failed === 0 ? "\nAll expected tables are present." : `\n${failed} table check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
