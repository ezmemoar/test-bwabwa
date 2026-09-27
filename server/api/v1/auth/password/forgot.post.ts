import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Email a password-reset link',
    description: 'Always answers 202, whether or not the address has an account, so it cannot be used to find out who is registered.',
  },
})

const body = z.object({ email: emailField })

export default defineEventHandler(async (event) => {
  await rateLimit(event, RateLimits.authRecoverIp, clientIp(event))
  const { email } = await validBody(event, body)
  await rateLimit(event, RateLimits.authRecoverEmail, emailKey(email))

  if (!useConfig().supabase.anonKey) throw problem(503, 'service_unavailable', 'Sign-in is not configured on this server.')
  try {
    await supabaseRecover(email)
  } catch (error) {
    // Swallowed: any difference in the answer would hint at whether the address has an account.
    log.warn('password reset request failed', serializeError(error))
  }
  setResponseStatus(event, 202)
  return { status: 'sent_if_registered' }
})
