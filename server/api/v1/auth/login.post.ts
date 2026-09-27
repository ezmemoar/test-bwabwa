import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Sign in with email and password',
    description:
      "Returns a Supabase session (access + refresh token) to use as `Authorization: Bearer` on every other endpoint. Send the device's anonymous access token as the bearer to merge that anonymous account into this one.",
  },
})

const body = z.object({
  email: emailField,
  password: z.string().min(1).max(1024),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, RateLimits.authLoginIp, clientIp(event))
  const input = await validBody(event, body)
  await rateLimit(event, RateLimits.authLoginEmail, emailKey(input.email))

  const session = await supabaseSignIn(input.email, input.password)

  const current = event.context.user
  const { merged } = current?.isAnonymous ? await adoptAnonymousAccount(current.id, session.user.id) : { merged: false }

  return { user: presentAuthUser(session.user), session: presentSession(session), mergedAnonymousAccount: merged }
})
