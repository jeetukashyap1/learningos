# LearningOS

A personalized learning platform built with Next.js 15 (App Router) and Supabase.
You describe a goal, LearningOS generates a structured learning path, attaches
curated video resources, and tracks progress lesson by lesson — with an AI tutor
that answers questions in the context of exactly where you are on your path.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Available scripts](#available-scripts)
- [Verification & test scripts](#verification--test-scripts)
- [Project structure](#project-structure)
- [How authentication works](#how-authentication-works)
- [Password reset flow](#password-reset-flow)
- [Troubleshooting](#troubleshooting)
- [Deployment](#deployment)

---

## Features

- **Guided onboarding** — pick a domain, level, goal, and time budget; the app
  builds a personalized curriculum.
- **AI-generated learning paths** — modules, lessons, concepts, and a final
  outcome generated via NVIDIA NIM and validated on the server before storage.
- **Curated video resources** — the YouTube Data API supplies ranked, level-aware
  learning resources per lesson, persisted and cached.
- **Journey, skills, practice, projects, progress** — the path is presented as a
  journey with module/lesson state, skill mastery, and practice tracking.
- **AI Tutor** — lesson-aware conversational help backed by server-derived
  context (the client never supplies the context it is answered with).
- **Accounts & security** — Supabase Auth (PKCE) with cookie-based sessions,
  row-level security on every table, protected routes, and a hardened
  password-recovery flow.
- **Demo mode** — preview the product with sample data before signing up.
- **Accessible, responsive UI** — dark/light-friendly styling, mobile navigation,
  keyboard shortcuts, and loading/empty/error states throughout.

---

## Tech stack

| Layer      | Choice                                                     |
| ---------- | ---------------------------------------------------------- |
| Framework  | Next.js 15 (App Router, React Server Components)           |
| Language   | TypeScript (strict)                                        |
| UI         | React 19, hand-written CSS design system, `lucide-react`   |
| Auth & DB  | Supabase (Postgres + Auth + Row Level Security)            |
| AI         | NVIDIA NIM (`lib/ai/client.ts`), server-side only          |
| Video      | YouTube Data API v3 (server-side only)                     |
| Linting    | ESLint (`eslint-config-next`), `tsc --noEmit`              |

---

## Prerequisites

- **Node.js 18.18 or newer** (Node 20 LTS recommended) — check with `node -v`
- **npm** (bundled with Node) — check with `npm -v`
- **Git**
- A **Supabase project** (the free tier is enough) for auth and data
- Optional: an **NVIDIA API key** (for AI path generation) and a **YouTube Data
  API v3 key** (for video resources). Without them the app runs; those features
  simply report themselves as unavailable.

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>

# 2. Install dependencies
npm install

# 3. Configure environment
#    Copy the template, then fill in your Supabase values (see below)
cp .env.example .env.local      # Windows (cmd): copy .env.example .env.local
                                # Windows (PowerShell): Copy-Item .env.example .env.local

# 4. Apply the database schema (see "Supabase setup")

# 5. Run the dev server
npm run dev
```

Open <http://localhost:3000>. Create an account, complete onboarding, and the app
will generate your first learning path.

> **No keys yet?** Visit <http://localhost:3000/demo> to explore the product with
> sample data — the demo never grants access to protected routes.

---

## Environment variables

`.env.local` is gitignored — **never commit real keys**. The template lives in
[`.env.example`](.env.example).

| Variable                        | Required | Exposed to browser | Purpose                                            |
| ------------------------------- | -------- | ------------------ | -------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes      | Yes                | Supabase project URL                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes      | Yes                | Supabase anon/public key (RLS protects your data)   |
| `YOUTUBE_API_KEY`               | No       | No (server only)   | YouTube Data API v3 key for learning resources      |
| `NVIDIA_API_KEY`                | No       | No (server only)   | NVIDIA NIM key for AI path generation + AI Tutor    |

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
YOUTUBE_API_KEY=your-youtube-key
NVIDIA_API_KEY=your-nvidia-key
```

The service-role key is intentionally **not** used by this app. If you ever need
it for admin work, keep it server-side only and never expose it to the client.

Restart the dev server after changing `.env.local`.

---

## Supabase setup

### 1. Create a project

Create a project at [supabase.com](https://supabase.com) and wait for it to
finish provisioning.

### 2. Get your credentials

**Project Settings → API**:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. Apply the database schema

Run every migration **in filename order** via the Supabase **SQL Editor**
(paste the file contents and run), or with the Supabase CLI
(`supabase db push`) if you use it.

```
supabase/migrations/
├── 20260907000000_create_profiles_and_onboarding.sql
├── 20260908000000_create_learning_resources.sql
├── 20260909000000_create_learning_paths.sql
├── 20260910000000_extend_personalized_learning.sql
├── 20260911000000_add_modules_and_final_outcome.sql
└── 20260912000000_create_ai_tutor_conversations.sql
```

Every table ships with Row Level Security enabled and owner-scoped policies, so
one user can never read another user's rows.

Verify the schema was applied:

```bash
node scripts/check-db-tables.mjs
```

### 4. Configure auth URLs

**Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000`
- **Redirect URLs** — add:
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/**` (convenient for local work)
  - `https://<your-production-domain>/auth/callback`

The password-reset email link returns through `/auth/callback`, so
`/auth/callback` **must** be allowed here or recovery links will fall back to the
Site URL.

### 5. Email (optional for local dev)

By default Supabase requires email confirmation. For fast local testing you can
turn it off under **Authentication → Providers → Email → Confirm email**. For
anything public, configure custom SMTP and keep confirmation on.

---

## Available scripts

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start the development server on port 3000    |
| `npm run build`     | Create an optimized production build         |
| `npm start`         | Serve the production build (run `build` first) |
| `npm run lint`      | Run ESLint                                   |
| `npm run typecheck` | Run TypeScript with no emit (`tsc --noEmit`) |

Production locally:

```bash
npm run build
npm start            # http://localhost:3000
npm start -- -p 3200 # custom port, e.g. http://localhost:3200
```

---

## Verification & test scripts

The `scripts/` folder holds developer tooling (not part of the app runtime). Most
read credentials from `.env.local` and expect a running server.

| Script                                  | Purpose                                                        |
| --------------------------------------- | -------------------------------------------------------------- |
| `node scripts/check-db-tables.mjs`      | Probe every table to confirm migrations are applied            |
| `node scripts/check-youtube-key.mjs`    | Validate the YouTube API key                                   |
| `node scripts/check-nvidia-key.mjs`     | Validate the NVIDIA API key                                    |
| `node scripts/check-nvidia-curriculum.ts` | Exercise curriculum generation against NVIDIA                |
| `node scripts/check-tier2-path.mjs`     | Inspect a persisted learning path for an account               |
| `node scripts/test-learning-path.mjs`   | E2E: learning-path generation & persistence                    |
| `node scripts/test-youtube-route.mjs`   | E2E: `/api/learning/youtube/search`                            |
| `node scripts/test-different-students.mjs` | E2E: multi-user isolation & domain coverage                 |
| `node scripts/test-ai-tutor.mjs`        | E2E: AI Tutor routes, ownership, context, error mapping        |
| `node scripts/debug-youtube.mjs`        | Diagnose YouTube search/scoring for a query                    |
| `npx tsx scripts/test-ai-validation.ts` | Unit tests for curriculum validation (no network/credentials)   |
| `npx tsx scripts/check-nvidia-curriculum.ts` | Manual NVIDIA curriculum probe                            |

E2E scripts take an optional base URL and default to a local production server on
`:3100`. Start one first, then run them:

```bash
npm run build && npm start -- -p 3100
node scripts/test-learning-path.mjs http://localhost:3100
```

Some suites read `TEST_EMAIL` / `TEST_PASSWORD` to exercise authenticated paths;
without them they run the credential-free security checks and skip the rest.

---

## Project structure

```
.
├── app/                        # App Router routes
│   ├── (app)/                  # Authenticated shell (dashboard, journey, ai-tutor, …)
│   ├── api/                    # Route handlers (learning paths, lessons, youtube, ai-tutor)
│   ├── auth/callback/          # Supabase auth callback (PKCE code + token_hash links)
│   ├── login, signup           # Authentication pages
│   ├── forgot-password         # Request a reset email
│   ├── reset-password          # Set a new password (dedicated recovery page)
│   ├── demo/                   # Sample-data preview
│   └── …                       # Marketing & legal pages
├── components/                 # Shared UI (app shell, auth form, cards, embeds)
├── lib/
│   ├── ai/                     # NVIDIA client, curriculum prompt, validation
│   ├── ai-tutor/               # Tutor context, prompt, service, HTTP helpers
│   ├── learning-path/          # Path generation, persistence, errors
│   ├── supabase/               # Browser/server clients, env, middleware
│   ├── youtube/                # Search, scoring, caching, persistence
│   ├── auth.ts                 # Server-side session/user helpers
│   └── auth-errors.ts          # Auth error → human message mapping
├── supabase/migrations/        # SQL migrations (schema + RLS)
├── scripts/                    # Developer verification & E2E tooling
├── middleware.ts               # Wires session refresh + route protection
└── next.config.ts              # Security headers
```

---

## How authentication works

- Sessions are cookie-based and handled by `@supabase/ssr` with the **PKCE** flow.
- [`middleware.ts`](middleware.ts) runs on every request and delegates to
  [`lib/supabase/middleware.ts`](lib/supabase/middleware.ts), which:
  - refreshes the session cookie,
  - redirects unauthenticated visits to protected routes to
    `/login?next=<path>`,
  - redirects signed-in visits to `/login` and `/signup` to `/dashboard`,
  - forwards stray Supabase auth links (`code`, `token_hash`, `type`) to
    `/auth/callback`, and keeps a recovery session on `/reset-password`.
- Protected routes are listed in `PROTECTED_ROUTE_PREFIXES`; the demo cookie never
  grants access to them.
- Server components read the current user through [`lib/auth.ts`](lib/auth.ts);
  Row Level Security is the real data boundary.

---

## Password reset flow

1. **/forgot-password** calls `resetPasswordForEmail` with
   `redirectTo=<origin>/auth/callback?next=/reset-password`.
2. Supabase emails a recovery link.
3. The link hits [`app/auth/callback/route.ts`](app/auth/callback/route.ts),
   which accepts both the PKCE `code` shape and the `token_hash` + `type=recovery`
   shape, exchanges the credential for a session, and always routes recovery to
   `/reset-password` — never the homepage or dashboard.
4. **/reset-password** validates the new password (required, ≥ 8 characters, and
   matching confirmation), then calls `supabase.auth.updateUser({ password })`.
5. On success the recovery session is **ended** (`signOut`) and the user is
   returned to `/login` (countdown + a "Continue to login" button). On failure an
   honest error is shown and the user stays on the page.

For this to work, `/auth/callback` must be listed under **Authentication → URL
Configuration → Redirect URLs** in Supabase.

---

## Troubleshooting

**“Authentication is not configured yet.”**
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing from
`.env.local`. Fill them in and restart the dev server.

**Recovery link opens the homepage and nothing happens.**
Add `http://localhost:3000/auth/callback` (and your production
`…/auth/callback`) to Supabase **Redirect URLs**, and set the **Site URL** to your
app origin.

**Signed in but bounced to `/dashboard` from `/login`.**
Expected: authenticated users are redirected away from `/login` and `/signup`.
Use the app navigation, or sign out from the top bar.

**A page shows a connection / fetch error.**
Confirm the dev server is running, the migration was applied, and your network can
reach Supabase.

**AI path generation is unavailable.**
`NVIDIA_API_KEY` is missing or invalid. The app keeps working; add the key to
enable generation. Check it with `node scripts/check-nvidia-key.mjs`.

**No video resources appear.**
`YOUTUBE_API_KEY` is missing, invalid, or over quota. Check it with
`node scripts/check-youtube-key.mjs`.

**Tables missing / 404 from the database.**
Run the migrations in order, then verify with
`node scripts/check-db-tables.mjs`.

**Port already in use.**
Run on another port: `npm run dev -- -p 3001` or `npm start -- -p 3200`.

**`npm run build` fails with `EINVAL: invalid argument, readlink '.next\…'`
(or `ENOENT` on a `.next` file), even though the file exists.**
The project is sitting inside a OneDrive‑synced folder. OneDrive *Files On‑Demand*
turns build files into reparse points, so Node's `readlink`/cache writes fail
because it mistakes them for symbolic links. Move the build output out of OneDrive
by running this once from the project root (Windows):

```bat
scripts\setup-external-build-dir.cmd
```

It points `.next` at `%USERPROFILE%\LearningOS-build\.next` through a directory
junction, and adds a matching `node_modules` link so the compiled server can still
resolve packages. The folder is ignored by Git, so it does not affect your
repository. Afterwards `npm run build` runs normally. On macOS/Linux, or if you
prefer not to use junctions, simply pause OneDrive while building.

**`npm run build` fails during "Generating static pages" with a Next.js-internal
error** — for example `Invariant: Expected workUnitAsyncStorage to have a store.
This is a bug in Next.js.`, or `EBUSY: resource busy or locked, open
'…\.next\server\chunks\…'` on a page that built fine before. This is a stale /
half-written build artifact, not an app bug. Recreate the build output from
scratch by running the setup script again — it wipes the external `.next`
directory before relinking — then rebuild:

```bat
scripts\setup-external-build-dir.cmd
npm run build
```

---

## Deployment

The app deploys cleanly to any Node host that supports Next.js (Vercel, Render,
Fly.io, a container, …).

1. Set the four environment variables in your host's dashboard. Keep
   `YOUTUBE_API_KEY` and `NVIDIA_API_KEY` **server-side only**.
2. Add your production `https://<domain>/auth/callback` to Supabase
   **Redirect URLs** and set the **Site URL** to `https://<domain>`.
3. Configure SMTP for production email delivery in Supabase.
4. Build and start:

```bash
npm ci
npm run build
npm start
```

Since all data access goes through Supabase with RLS and the anon key, no
service-role secret is required at runtime.

---

## License

Add your license here (for example, the [MIT License](https://choosealicense.com/licenses/mit/)).
