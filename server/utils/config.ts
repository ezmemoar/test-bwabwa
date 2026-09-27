import { z } from 'zod'

/** Number of trusted reverse proxies in front of the server. `true` means one, `false` none. */
const proxyHops = z
  .union([z.boolean(), z.number(), z.string()])
  .transform((v) => (v === true || v === 'true' ? 1 : v === false || v === 'false' || v === '' ? 0 : Number(v)))
  .pipe(z.int().min(0).max(10))

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string')

const configSchema = z
  .object({
    supabase: z.object({
      databaseUrl: postgresUrl,
      directUrl: z.union([z.literal(''), postgresUrl]),
      databasePoolMax: z.coerce.number().int().min(1).max(100),
      databaseCa: z.string(),
      url: z.union([z.literal(''), z.url()]),
      anonKey: z.string(),
      secretKey: z.string(),
      jwtSecret: z.string(),
    }),
    redisUrl: z.string(),
    trustProxy: proxyHops,
    corsOrigins: z.string().transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
    autoHideReportThreshold: z.coerce.number().int().min(1),
    reportMinAccountAgeHours: z.coerce.number().min(0),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  })
  .transform((c, ctx) => {
    const url = (c.supabase.url || supabaseUrlFromDatabaseUrl(c.supabase.databaseUrl) || '').replace(/\/+$/, '')
    if (!url) {
      ctx.addIssue({ code: 'custom', path: ['supabase', 'url'], message: 'set NUXT_SUPABASE_URL (it cannot be derived from this database URL)' })
      return z.NEVER
    }
    return { ...c, supabase: { ...c.supabase, url } }
  })

export type AppConfig = z.output<typeof configSchema>

let cached: AppConfig | undefined

/** Runtime config, validated once. Throws with every problem listed if the environment is incomplete. */
export function useConfig(): AppConfig {
  if (cached) return cached
  const result = configSchema.safeParse(useRuntimeConfig())
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid server configuration (set the matching NUXT_* environment variables):\n${problems}`)
  }
  cached = result.data
  return cached
}
