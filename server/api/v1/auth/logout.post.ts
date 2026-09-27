import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Sign out',
    description:
      '`local` (default) ends this session, `global` every session of the account, `others` every session but this one. The access token stays valid until it expires (at most an hour); its refresh token stops working immediately.',
    security: [{ bearer: [] }],
  },
})

const body = z.object({ scope: z.enum(['local', 'global', 'others']).default('local') })

export default defineEventHandler(async (event) => {
  requireUser(event)
  const { scope } = await validBody(event, body)
  await supabaseSignOut(bearerToken(event)!, scope)
  return sendNoContent(event)
})
