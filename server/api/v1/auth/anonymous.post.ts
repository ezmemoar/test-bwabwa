defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Create an anonymous account',
    description:
      'What every install does on its first online action: returns a session for a new anonymous account, to use as `Authorization: Bearer` and refresh with `/auth/refresh`. The profile is created on first use. Registering, logging in or signing in with Google later while sending this token merges the anonymous account into that one.',
  },
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, RateLimits.authAnonymousIp, clientIp(event))
  const session = await supabaseSignInAnonymously()
  setResponseStatus(event, 201)
  return { user: presentAuthUser(session.user), session: presentSession(session) }
})
