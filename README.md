# Climbly API

The backend for the Climbly Android app. It is an API-only Nuxt 4 project: Nitro serves `server/`, with no pages
and no Vue renderer. The database is Supabase Postgres.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Nuxt 4 / Nitro (h3), `node-server` preset | Small, fast cold starts; deploys to any Node host, a container or serverless |
| Database | Supabase Postgres via **Prisma ORM 7** (`prisma-client` generator + `@prisma/adapter-pg`) | Prisma 7 has no Rust engine; the `pg` driver adapter talks to the pooler directly. It works with Supabase's transaction pooler too, and skipping PostgREST saves a network hop per query. Typed client, Prisma Migrate |
| Auth | **Supabase Auth**; access tokens verified locally with **jose** | JWKS (ES256/RS256) is cached, so verification needs no network call. Legacy HS256 works only when its secret is configured |
| Authorization | Roles and bans live in `profiles` (database), not in the JWT | Granting, revoking or banning takes effect on the next request |
| Rate limiting | **rate-limiter-flexible**, in memory or Redis | Atomic counters; with Redis, an in-memory insurance limiter takes over during outages |
| Validation | **zod 4** | Every body, query and path param; text is NFC-normalised and stripped of control/bidi characters |
| Errors | RFC 9457 `application/problem+json` | Stable machine `code`, `requestId`, and field errors for 422 |
| Docs | Nitro OpenAPI + Scalar | `/api/docs` and `/api/openapi.json` (dev) |
| Tests | Vitest end-to-end against the **production build** | PGlite (real Postgres, in memory) over the wire protocol, plus a fake Supabase JWKS |

## Security model

- **The anon key is public** (it ships in the app). Every table has RLS enabled with no policies, and migration
  the `supabase_hardening` migration revokes the grants Supabase gives `anon` and `authenticated`, so nothing
  is reachable through PostgREST. The API connects as the table owner and enforces access itself.
- **Link to Supabase Auth**: Prisma manages only `public`; Supabase's `auth` schema is invisible to it on purpose
  (listing it makes Migrate treat Supabase's own tables as drift to drop, and refuse to deploy into a
  "non-empty" database). Instead of a foreign key into `auth`, which Prisma can't introspect (P4002), a trigger
  on `auth.users` (function in the private `climbly_private` schema) deletes the profile when Supabase deletes
  the user, and that cascades to everything the user owns. The API checks `auth.users` before creating a
  profile, so a still-valid token of a deleted account is refused.
- **Middleware order** (`server/middleware`): request id and security headers → CORS (opt-in) → body guard
  (JSON only, 64 KB; 2 MB for `/journey`; no unsized bodies) → per-IP rate limit → token verification and a
  per-user rate limit. Handlers then call `requireUser`, `useProfile`, `requireActiveMember` (not banned) or
  `requireRole` (which also refuses suspended staff).
- **Rate limits** are all defined in `server/utils/rate-limit.ts`: 300/min per IP, 120/min per user, plus
  stricter limits on writes (5 posts per 15 min, 30 comments per 15 min, 20 reports per hour, 3 account
  deletions per hour, and more). Every write is also capped **per client IP** (`rateLimitWrite`), because
  anonymous accounts are free and per-user limits alone could be multiplied. Responses carry `RateLimit-*`
  headers; a 429 also carries `Retry-After`.
- **Client IP**: `NUXT_TRUST_PROXY` is the number of proxies in front of the API. The IP is read that many
  entries from the *right* of `X-Forwarded-For`, because the left part is client-controlled (h3's
  `getRequestIP` takes the leftmost entry and must not be used for this). Set it to the real hop count:
  too high lets clients spoof their IP, and too low makes everyone share the proxy's IP.
- **Idempotency**: clients send their own UUID when creating posts and comments, so a retry returns the
  original instead of creating a duplicate. Journey backups are whole snapshots; an older snapshot can't
  overwrite a newer one (`409 stale_snapshot`).
- **Forum safety**: links are refused (`links_not_allowed`). Content is auto-hidden after N distinct reports
  (`NUXT_AUTO_HIDE_REPORT_THRESHOLD`, default 3), counting only reports from accounts at least
  `NUXT_REPORT_MIN_ACCOUNT_AGE_HOURS` old (default 24) that aren't banned. That stops throwaway accounts from
  silencing people; their reports still reach the moderator queue. Staff-sounding usernames ("Climbly
  Support", "admin", "the.mods", look-alike spellings) are reserved for moderators and admins. There is a
  moderator queue with dismiss, remove and restore; users can hide ("block") other users; moderators and
  admins can ban, and only admins can ban or unban a moderator. This covers Google Play's UGC requirements.
- **Supabase side**: turn on CAPTCHA (hCaptcha/Turnstile) for anonymous sign-ins, and keep Supabase's
  per-IP sign-up limit. Account creation is the one abuse vector this API can't limit itself.
- **Account deletion** (`DELETE /api/v1/me`) removes the Supabase auth user, which cascades to every row, as
  Google Play requires.

## Endpoints

All `/api/v1/*` routes need `Authorization: Bearer <Supabase access token>`, except the sign-in routes under
`/api/v1/auth/`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health`, `/api/health/ready` | Liveness, and readiness (DB ping) |
| POST | `/api/v1/auth/register` | `{ email, password, username? }` → session, or `confirmationRequired` if the project confirms emails |
| POST | `/api/v1/auth/login` | `{ email, password }` → `{ user, session: { accessToken, refreshToken, expiresAt } }` |
| POST | `/api/v1/auth/google` | `{ idToken, nonce }` from Android Credential Manager → session (account created on first use) |
| POST | `/api/v1/auth/refresh` | `{ refreshToken }` → new session (refresh tokens are single-use) |
| POST | `/api/v1/auth/logout` | Bearer required; `{ scope: local \| global \| others }` |
| POST | `/api/v1/auth/password/forgot` | `{ email }` → always 202 (no account enumeration) |
| GET, PATCH, DELETE | `/api/v1/me` | Profile (created on first call), `username` (`displayName` accepted as an alias), account deletion |
| GET, POST | `/api/v1/posts` | Feed (keyset `cursor`, `limit` ≤ 50), create |
| GET, DELETE | `/api/v1/posts/:id` | Author or moderator can delete |
| GET, POST | `/api/v1/posts/:id/comments` | Oldest first, keyset pagination |
| DELETE | `/api/v1/comments/:id` | Author or moderator |
| POST | `/api/v1/reports` | `{ targetType, targetId, reason, details? }` → 202 |
| GET / PUT, DELETE | `/api/v1/blocks` / `/api/v1/blocks/:userId` | Hide a person's posts and comments |
| GET, PUT | `/api/v1/journey` | Opt-in backup of check-ins, relapses and habit completions |
| GET | `/api/v1/moderation/reports` | Moderators |
| POST | `/api/v1/moderation/reports/:id/resolve` | `{ action: dismiss \| remove \| restore }` |
| PUT, DELETE | `/api/v1/moderation/users/:id/ban` | Moderators (admins for banning moderators) |
| PUT | `/api/v1/admin/users/:id/role` | Admins |

## Setup

```bash
pnpm install
cp .env.example .env               # fill in the Supabase values
pnpm db:migrate                    # prisma migrate deploy (use a session-mode URL)
pnpm db:seed                       # optional: demo data in every table (dev/staging only)
pnpm dev                           # http://localhost:3000, docs at /api/docs
```

Supabase dashboard:

1. **Authentication → Sign In / Providers → Allow anonymous sign-ins: on.** The app signs every install in
   anonymously. Keep CAPTCHA or the default anonymous sign-in rate limit on.
2. **Email provider on** for register/login, and put the publishable key in `NUXT_SUPABASE_ANON_KEY`. With
   *Confirm email* on (the default), `register` returns `confirmationRequired: true` and the person signs in
   after clicking the link. Supabase's built-in mailer only delivers to your team's addresses and a few emails
   an hour; set up custom SMTP (Authentication → Emails) before real users sign up.
3. **Authentication → Rate Limits**: every register/login/refresh reaches Supabase from this server's IP, so
   Supabase's per-IP limits count all users together. Raise them to fit your traffic; this API enforces its
   own per-client-IP and per-email limits in front (`server/utils/rate-limit.ts`).
4. Use JWT signing keys (the default for new projects). Only set `NUXT_SUPABASE_JWT_SECRET` on a legacy project.
5. Give yourself admin rights after your first request has created your profile:
   `update profiles set role = 'admin' where id = '<your auth user id>';`

### Sign-in flows

- **Anonymous (every install)**: the app gets an anonymous Supabase session and uses the API with it.
- **Register / login with email** (`/api/v1/auth/*`): the backend calls Supabase Auth (GoTrue) and returns the
  session. If the request also carries the device's **anonymous** access token as `Authorization: Bearer`, that
  anonymous account's posts, comments, reports, blocks, username and journey backup are moved into the email
  account (`server/utils/account-merge.ts`); a ban on the anonymous account carries over. Supabase can't give
  an anonymous user a password before its email is verified, which is why the merge happens server-side,
  following Supabase's own "link an anonymous user to an existing account" pattern.
- **Every other request**: `Authorization: Bearer <accessToken>`, refreshed with `/api/v1/auth/refresh`.

### Schema changes (Prisma)

1. Edit `prisma/schema.prisma`.
2. Run `pnpm db:migrate:dev --name <change>`, which writes `prisma/migrations/<timestamp>_<change>/migration.sql` and
   applies it. It needs a shadow database: locally it creates one itself. Against a remote database, set
   `SHADOW_DATABASE_URL` to an empty scratch database. `migrations.initShadowDb` in `prisma.config.ts` recreates
   Supabase's `auth.users` and API roles there.
3. Review the SQL. For anything Prisma doesn't model, such as RLS on a new table, CHECK constraints, grants or
   triggers, add SQL by hand to the generated migration: `ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;` for
   every new table. Prisma's diff ignores these, so they never show up as drift. **Renames** need a hand
   edit too: Prisma writes a renamed field as DROP COLUMN + ADD COLUMN, which loses the data; replace it with
   `ALTER TABLE ... RENAME COLUMN` (see `20260927000200_rename_display_name_to_username`). Never add `auth` to
   the datasource `schemas` (see "Link to Supabase Auth" above).
4. Deploy with `pnpm db:migrate` (`prisma migrate deploy`). The client is regenerated on install and build
   (`prisma generate` writes to `server/generated/prisma`, which is gitignored).

Check for drift at any time with
`pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`. Against the
current migrations it reports "No difference detected".

No database at hand? `pnpm db:local` starts an in-memory Postgres (PGlite, with Supabase's `auth` schema
stubbed) on port 54329. Point `NUXT_SUPABASE_DATABASE_URL` and `NUXT_SUPABASE_DIRECT_URL` at `postgres://postgres:postgres@127.0.0.1:54329/postgres`,
then run `pnpm db:migrate` and `pnpm db:seed`.

### Seed data

`pnpm db:seed` (`prisma/seed.ts`, fixtures in `prisma/seed/data.ts`) fills every table:

- 12 users with profiles: regular members, one posting anonymously, a banned spammer, a moderator
  (`climbly_mod`) and an admin (`climbly_admin`).
- 10 forum posts with comments, one of them a spam post hidden by 3 open reports.
- One dismissed report, and one user block.
- Journey backups for 3 users: about 120 check-ins, relapses and about 450 habit completions.

It's idempotent: ids come from names, so re-running converges instead of duplicating (the test suite runs
it twice). Auth users are created through the Supabase Admin API when `NUXT_SUPABASE_SECRET_KEY` is set, as
`<handle>@seed.climbly.example.com`. Otherwise, or with `SEED_AUTH=direct`, they're inserted straight into
`auth.users`, which is only meant for local databases. It refuses to run with `NODE_ENV=production` unless
given `--force`. `pnpm db:reset` drops the database, re-applies the migrations and seeds again.

### Connecting the Android app

Add the following to `app/local.properties` (it's gitignored), then rebuild:

```properties
climbly.supabaseUrl=https://<project-ref>.supabase.co
climbly.supabaseAnonKey=<publishable / anon key>
# Debug builds default to http://10.0.2.2:3000/ (this server's `pnpm dev`, seen from the emulator).
# climbly.apiBaseUrl=http://192.168.1.20:3000/
climbly.apiBaseUrl.release=https://api.example.com/
# Sign in with Google: the Web OAuth client ID (see below). Empty hides the option.
climbly.googleWebClientId=<id>.apps.googleusercontent.com
```

The app signs itself in anonymously against Supabase Auth on the first online action (opening the forum,
posting, or turning on backup). It then calls this API with the access token. Without these keys the app
still runs, fully offline.

### Sign in with Google (Profile → Account)

The app uses Android Credential Manager ("Sign in with Google", which lists the Google accounts on the
phone), sends the resulting Google ID token plus a raw nonce to `POST /api/v1/auth/google`, and Supabase
Auth verifies it. Supabase checks the signature, that the audience is one of your client IDs, and that
sha256(nonce) matches the token. The device's anonymous account is merged in. The Google name and photo are
not copied into the profile. One-time setup:

1. **Google Cloud Console → Google Auth Platform**: configure the consent screen (scopes `openid`, `email`,
   `profile`).
2. **Clients → Create client → Web application.** Its client ID is `climbly.googleWebClientId`, and its
   client ID and secret go into Supabase (step 4).
3. **Clients → Create client → Android**, package `com.devfolk.climbly`, once per signing key's SHA-1:
   - debug (this machine): `16:E3:09:E9:D3:5D:6D:16:46:EA:55:A8:CD:AA:89:4F:6F:94:5D:63`
   - release keystore (`climbly`): `C4:29:C4:C4:C1:89:42:8B:5B:03:EB:C2:06:65:E5:FD:29:C4:9D:89`
   - **Google Play**: with Play App Signing, Play re-signs the app, so also add the *app signing key*
     SHA-1 from Play Console → Test and release → App integrity. Otherwise sign-in fails only for Play installs.
4. **Supabase → Authentication → Sign In / Providers → Google**: enable it. Put the Web client ID *first* in
   *Client IDs*, add the Web client secret, and leave *Skip nonce check* off.

Errors from Credential Manager usually mean a missing Android client or SHA-1, or the Web client ID wasn't
used as the server client ID. `401 invalid_credentials` from the API means Supabase rejected the token
(client ID list or nonce).

## Scripts

| Script | |
| --- | --- |
| `pnpm dev` | Dev server with HMR |
| `pnpm build` / `pnpm start` | Production build in `.output/`; `node .output/server/index.mjs` |
| `pnpm test` | Build, then run the end-to-end suite against the build (no Docker or Supabase needed) |
| `pnpm test:only` | Re-run the suite against the existing build |
| `pnpm typecheck` | `nuxt typecheck` |
| `pnpm db:migrate` / `db:migrate:dev` / `db:status` | `prisma migrate deploy` / `migrate dev` / `migrate status` |
| `pnpm db:seed` / `db:reset` | Seed demo data / reset the database and re-seed |
| `pnpm db:generate` / `db:studio` | `prisma generate` / Prisma Studio |
| `pnpm db:local` | In-memory Postgres (PGlite) with Supabase's `auth` schema stubbed, on port 54329 |

## Deploying

- **Container**: `docker build -t climbly-api .` gives a non-root image that holds only `.output`, with a
  healthcheck on `/api/health`.
- **Any Node host** (Fly, Railway, Render): `pnpm build`, then run `node .output/server/index.mjs`. Set the
  `NUXT_*` variables, `NUXT_TRUST_PROXY=1` behind the platform's proxy (2 with Cloudflare in front of it), and `NUXT_REDIS_URL` when running
  more than one instance.
- **Serverless**: set `NITRO_PRESET` (e.g. `vercel`) at build time and use the Supabase transaction pooler (6543).
  Rate limits then need Redis, because in-memory state doesn't survive between invocations.

## Layout

```
server/
  api/                 route handlers (file-based: posts/[id]/comments/index.post.ts → POST /api/v1/posts/:id/comments)
  generated/prisma/    Prisma Client (generated, gitignored)
  middleware/          01 context → 02 cors → 03 request guard → 04 IP limit → 05 auth
  plugins/lifecycle.ts config check at boot, access log, graceful shutdown
  utils/               auto-imported helpers: config, prisma, auth, profiles, rate-limit, validation, problem, cursor, forum, presenters, journey, logger
  error.ts             problem+json error handler
prisma/
  schema.prisma        data model (source of truth)
  migrations/          Prisma Migrate SQL: init (generated) + supabase_hardening (RLS, CHECKs, revokes)
  seed.ts, seed/data.ts  idempotent seed for every table
prisma.config.ts       migrations path and TLS, seed command, shadow-DB init (Supabase auth stub)
tests/                 end-to-end suite (global-setup boots PGlite, runs prisma migrate deploy + the seed twice, a fake JWKS and the built server)
```
