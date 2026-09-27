// The Android app doesn't need CORS. Browser origins (an admin panel, a future web app) are opt-in through
// NUXT_CORS_ORIGINS; without it no CORS headers are sent and browsers keep cross-origin calls blocked.
export default defineEventHandler((event) => {
  const { corsOrigins } = useConfig()
  if (corsOrigins.length === 0 || !event.path.startsWith('/api/')) return
  handleCors(event, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy'],
    maxAge: '600',
  })
})
