/**
 * Replacement for `.env`: the settings used by the API (via nuxt.config.ts), Prisma (prisma.config.ts) and the
 * seeder (prisma/seed.ts). Each entry is only a fallback: a variable that is set in the real environment (the
 * Vercel dashboard, your shell, the test setup) always wins over the value written here.
 *
 * nuxt.config.ts copies these values into runtimeConfig, so they are baked into the build. A Vercel build only
 * sees them when this file is committed, which means everyone with access to the repository can read them.
 */
export const env = {
  // Postgres URL the running API uses. The transaction pooler (port 6543) is the best fit.
  NUXT_SUPABASE_DATABASE_URL: 'postgresql://postgres.azcvdphggrbnblfvkhtv:E7jL8LweHXyS60y3@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  // Session pooler (port 5432) or direct connection: used by Prisma migrations (and the seeder).
  NUXT_SUPABASE_DIRECT_URL: 'postgresql://postgres.azcvdphggrbnblfvkhtv:E7jL8LweHXyS60y3@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  NUXT_SUPABASE_DATABASE_POOL_MAX: '10',
  // Optional: Supabase's CA certificate (PEM). Without it the database connection is encrypted but unverified.
  NUXT_SUPABASE_DATABASE_CA: '',

  // Optional: https://<project-ref>.supabase.co. Derived from the database URL when left empty.
  NUXT_SUPABASE_URL: '',
  // Publishable key (sb_publishable_...) or legacy anon key. Required for /api/v1/auth/*.
  NUXT_SUPABASE_ANON_KEY: '',
  // Secret key (sb_secret_...) or legacy service_role key. Needed for account deletion.
  NUXT_SUPABASE_SECRET_KEY: '',
  // Only for projects still on the legacy shared JWT secret.
  NUXT_SUPABASE_JWT_SECRET: '',

  // Overrides the migration URL above for a one-off (e.g. another environment).
  MIGRATION_DATABASE_URL: '',
  // Only for `pnpm db:migrate:dev` against a remote database: an empty scratch database Prisma may wipe.
  SHADOW_DATABASE_URL: '',
  // "direct" makes `pnpm db:seed` insert auth users straight into auth.users (local databases only).
  SEED_AUTH: '',

  // Optional: share rate limits across instances.
  NUXT_REDIS_URL: '',
  // Reverse proxies in front of the API (true = 1). Vercel: 1.
  NUXT_TRUST_PROXY: 'false',
  // Comma-separated browser origins allowed by CORS. The Android app doesn't need this.
  NUXT_CORS_ORIGINS: '',
  NUXT_AUTO_HIDE_REPORT_THRESHOLD: '3',
  NUXT_REPORT_MIN_ACCOUNT_AGE_HOURS: '24',
  NUXT_LOG_LEVEL: 'info',
}

/** Copies `env` into process.env for every variable that isn't set already (like dotenv, it never overrides). */
export function loadEnv(): void {
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
