import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Exchange a refresh token for a new session',
    description: 'Refresh tokens are single-use: store the new one from the response. A reused or revoked token answers 401 `invalid_token`.',
  },
})

const body = z.object({ refreshToken: z.string().min(1).max(1024) })

export default defineEventHandler(async (event) => {
  await rateLimit(event, RateLimits.authRefreshIp, clientIp(event))
  const { refreshToken } = await validBody(event, body)
  const session = await supabaseRefresh(refreshToken)
  return { user: presentAuthUser(session.user), session: presentSession(session) }
})
