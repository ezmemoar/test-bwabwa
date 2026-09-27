// https://nuxt.com/docs/api/configuration/nuxt-config
//
// API-only Nuxt: no pages, no Vue server renderer. Everything lives in `server/` and is served by Nitro.
import { env } from './env'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  telemetry: false,
  ssr: false,
  pages: false,

  experimental: {
    // Drop the Vue renderer from the production server bundle: unknown routes become plain JSON 404s.
    noVueServer: true,
  },

  // Defaults come from env.ts and are baked into the build. Every value can still be overridden at runtime with
  // NUXT_<SCREAMING_SNAKE_CASE> of its path (supabase.databaseUrl -> NUXT_SUPABASE_DATABASE_URL).
  // server/utils/config.ts validates the merged result once at boot and fails fast on bad input.
  runtimeConfig: {
    supabase: {
      /** NUXT_SUPABASE_DATABASE_URL: what the running API uses (transaction pooler, port 6543, is fine). */
      databaseUrl: env.NUXT_SUPABASE_DATABASE_URL,
      /** NUXT_SUPABASE_DIRECT_URL: session pooler (5432) or direct connection; used by Prisma migrations. */
      directUrl: env.NUXT_SUPABASE_DIRECT_URL,
      /** NUXT_SUPABASE_DATABASE_POOL_MAX */
      databasePoolMax: env.NUXT_SUPABASE_DATABASE_POOL_MAX,
      /** NUXT_SUPABASE_DATABASE_CA: Supabase's CA certificate (PEM) to verify the database's TLS certificate. */
      databaseCa: env.NUXT_SUPABASE_DATABASE_CA,
      /** NUXT_SUPABASE_URL: https://<ref>.supabase.co. Optional: derived from the database URL when empty. */
      url: env.NUXT_SUPABASE_URL,
      /** NUXT_SUPABASE_ANON_KEY: publishable (anon) key. Needed for login/register (Supabase Auth). */
      anonKey: env.NUXT_SUPABASE_ANON_KEY,
      /** NUXT_SUPABASE_SECRET_KEY: secret / service-role key, only for admin calls (account deletion). */
      secretKey: env.NUXT_SUPABASE_SECRET_KEY,
      /** NUXT_SUPABASE_JWT_SECRET: legacy HS256 secret. Leave empty on projects using JWT signing keys. */
      jwtSecret: env.NUXT_SUPABASE_JWT_SECRET,
    },
    /** Optional. When set, rate limits are shared across instances through Redis. */
    redisUrl: env.NUXT_REDIS_URL,
    /** How many reverse proxies you run in front of the server (true = 1). 0/false: use the socket address. */
    trustProxy: env.NUXT_TRUST_PROXY,
    /** Comma-separated list of browser origins allowed by CORS. Native apps don't need CORS. */
    corsOrigins: env.NUXT_CORS_ORIGINS,
    /** A post or comment is hidden automatically once this many distinct people report it. */
    autoHideReportThreshold: env.NUXT_AUTO_HIDE_REPORT_THRESHOLD,
    /** Reports only count toward auto-hiding once the reporting account is this old (anti-brigading). */
    reportMinAccountAgeHours: env.NUXT_REPORT_MIN_ACCOUNT_AGE_HOURS,
    logLevel: env.NUXT_LOG_LEVEL,
  },

  nitro: {
    errorHandler: '~~/server/error',
    rollupConfig: {
      plugins: [
        {
          // The generated Prisma client sets `globalThis.__dirname` from import.meta.url at load time. Inside
          // Nitro's bundle import.meta.url is a placeholder (file:///_entry.js) when that code runs, which
          // throws on Windows. Prisma 7 doesn't need the directory (its query compiler is inlined as base64
          // WASM), so the assignment is made harmless.
          name: 'climbly:prisma-client-dirname',
          transform(code: string, id: string) {
            if (!id.replace(/\\/g, '/').includes('/server/generated/prisma/')) return null
            const patched = code.replace(
              /globalThis\[(['"])__dirname\1\]\s*=\s*path\.dirname\(fileURLToPath\((?:import\.meta|globalThis\._importMeta_)\.url\)\)/,
              "globalThis['__dirname'] ??= process.cwd()",
            )
            return patched === code ? null : { code: patched, map: null }
          },
        },
      ],
    },
    experimental: {
      openAPI: true,
    },
    openAPI: {
      route: '/api/openapi.json',
      meta: {
        title: 'Climbly API',
        description: 'Backend for the Climbly Android app.',
        version: '1.0.0',
      },
      ui: {
        scalar: { route: '/api/docs' },
        swagger: false,
      },
    },
  },

  typescript: {
    strict: true,
  },
})
