// No Nitro imports: also used by prisma/seed.ts, which runs outside the server.

/**
 * TLS for the database. Supabase's poolers are always reached over TLS. With its CA certificate
 * (NUXT_SUPABASE_DATABASE_CA, from Dashboard → Database → SSL) the server certificate is verified; without it
 * the connection is still encrypted but unverified, and a warning says so. `sslmode=disable` turns TLS off
 * (local Postgres). Connection-string SSL parameters are removed afterwards: node-postgres would let them
 * override this setting.
 */
export function databaseConnection(databaseUrl: string, ca: string) {
  const url = new URL(databaseUrl)
  const mode = url.searchParams.get('sslmode')
  const hosted = /\.supabase\.(co|com)$/.test(url.hostname)
  for (const p of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat', 'pgbouncer']) url.searchParams.delete(p)

  let ssl: false | { ca?: string; rejectUnauthorized: boolean } = false
  let verified = false
  if (mode !== 'disable' && (hosted || (mode !== null && mode !== 'allow' && mode !== 'prefer') || ca)) {
    ssl = ca ? { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false }
    verified = Boolean(ca)
  }
  return { connectionString: url.toString(), ssl, encrypted: ssl !== false, verified }
}

/**
 * The project URL from a Supabase database URL: pooler URLs log in as `postgres.<ref>`, direct ones connect to
 * `db.<ref>.supabase.co`. Lets NUXT_SUPABASE_URL stay optional when the database URL is already set.
 */
export function supabaseUrlFromDatabaseUrl(databaseUrl: string): string | undefined {
  try {
    const u = new URL(databaseUrl)
    const ref = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1] ?? /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)?.[1]
    return ref ? `https://${ref}.supabase.co` : undefined
  } catch {
    return undefined
  }
}
