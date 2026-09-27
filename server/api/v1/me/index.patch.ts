import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Change the username shown on new forum posts',
    description: '`displayName` is accepted as an older alias of `username`. An empty value or null means anonymous.',
    security: [{ bearer: [] }],
  },
})

const body = z
  .object({ username: usernameField.optional(), displayName: usernameField.optional() })
  .refine((b) => b.username !== undefined || b.displayName !== undefined, { message: 'is required', path: ['username'] })

export default defineEventHandler(async (event) => {
  await rateLimitWrite(event, RateLimits.profileWrite, RateLimits.profileWriteIp)
  const input = await validBody(event, body)
  const field = input.username !== undefined ? 'username' : 'displayName'
  const username = (input.username !== undefined ? input.username : input.displayName) ?? null

  const current = await useProfile(event)
  // Staff-sounding names are for staff: nobody else gets to post as "Climbly Support".
  assertUsernameAllowed(username, hasRole(current, 'moderator'), field)

  const updated = await usePrisma().profile.update({ where: { id: current.id }, data: { username } })
  return presentMe(updated, requireUser(event))
})
