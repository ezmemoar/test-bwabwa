import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Migrations need a session-capable connection: Supabase's direct connection or the session pooler (port
// 5432), not the transaction pooler (6543) that the running API uses.
const url = withTls(
  process.env.MIGRATION_DATABASE_URL || process.env.NUXT_SUPABASE_DIRECT_URL || process.env.NUXT_SUPABASE_DATABASE_URL,
)

/**
 * Supabase accepts plain connections, so ask for TLS explicitly. Without Supabase's CA certificate the
 * certificate can't be verified (same trade-off as the API, see server/utils/database-connection.ts); an
 * explicit `sslmode` in the URL always wins.
 */
function withTls(raw: string | undefined): string | undefined {
  if (!raw) return raw
  try {
    const u = new URL(raw)
    if (/\.supabase\.(co|com)$/.test(u.hostname) && !u.searchParams.has('sslmode')) {
      u.searchParams.set('sslmode', 'require')
      u.searchParams.set('sslaccept', 'accept_invalid_certs')
    }
    return u.toString()
  } catch {
    return raw
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
    // `migrate dev` diffs against a throwaway shadow database, which has none of Supabase's objects.
    // Recreate the ones the migrations rely on: the auth.users table and the API roles.
    initShadowDb: `
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `,
  },
  // Required for `initShadowDb` above. No table is declared external: `auth` is simply outside `schemas`.
  experimental: { externalTables: true },
  // Only needed by migrate/introspect commands; `prisma generate` works without a database.
  ...(url ? { datasource: { url, shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined } } : {}),
})
