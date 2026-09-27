import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Create an account with email and password',
    description:
      'Signs up with Supabase Auth. If the project requires email confirmation, the account is created without a session (`confirmationRequired: true`) and the person signs in after clicking the link. Send the device\'s anonymous access token as `Authorization: Bearer` to move that anonymous account\'s posts, reports, blocks and journey into the new account.',
  },
})

const body = z.object({
  email: emailField,
  password: passwordField,
  username: usernameField.optional(),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, RateLimits.authRegisterIp, clientIp(event))
  const input = await validBody(event, body)
  const username = input.username ?? null
  assertUsernameAllowed(username, false)

  const result = await supabaseSignUp(input.email, input.password, username)
  setResponseStatus(event, 201)

  if (!isSession(result)) {
    // Email confirmation pending: no session yet. The username waits in the user metadata and lands in the
    // profile on first sign-in; the anonymous account is merged then too.
    return { user: presentAuthUser(result), session: null, confirmationRequired: true, mergedAnonymousAccount: false }
  }

  await usePrisma().profile.upsert({ where: { id: result.user.id }, create: { id: result.user.id, username }, update: {} })
  const current = event.context.user
  const { merged } = current?.isAnonymous ? await adoptAnonymousAccount(current.id, result.user.id) : { merged: false }
  log.info('account registered', { userId: result.user.id, mergedFrom: merged ? current!.id : undefined })

  return {
    user: presentAuthUser(result.user),
    session: presentSession(result),
    confirmationRequired: false,
    mergedAnonymousAccount: merged,
  }
})
