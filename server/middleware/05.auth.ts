// Authentication is decided once, here: a request either carries a valid Supabase access token (and gets a
// per-user rate limit), carries no token (handlers that need one call requireUser and get a 401), or carries
// a bad one and is rejected outright.
//
// Exception: the sign-in routes (anonymous, register, login, refresh, password reset). A token there is optional
// context (the device's anonymous account, to merge), and an expired one must not stop anyone from signing
// in, so an unusable token just means "no current user".
const LENIENT = /^\/api\/v1\/auth\/(anonymous|register|login|google|refresh|password\/)/

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/v1/')) return

  const lenient = LENIENT.test(event.path)
  const token = bearerToken(event)
  if (token === undefined || (token === null && lenient)) {
    event.context.user = null
    return
  }
  if (token === null) throw unauthorized('Malformed Authorization header; expected "Bearer <token>".', 'invalid_token')

  try {
    event.context.user = await verifyAccessToken(token)
  } catch (error) {
    if (!lenient) throw error
    event.context.user = null
    return
  }
  await rateLimit(event, RateLimits.user, event.context.user.id)
})
