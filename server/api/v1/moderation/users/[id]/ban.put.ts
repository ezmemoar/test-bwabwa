import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['moderation'],
    summary: 'Suspend a user from posting and commenting (moderators)',
    description: 'Omit `until` for an indefinite ban. Moderators can only ban regular users; admins can ban moderators.',
    security: [{ bearer: [] }],
  },
})

const body = z.object({
  until: z.iso
    .datetime({ offset: true })
    .optional()
    .refine((v) => !v || new Date(v) > new Date(), 'must be in the future'),
  reason: cleanText(1, 500).optional(),
})

const INDEFINITE = new Date('9999-12-31T00:00:00Z')

export default defineEventHandler(async (event) => {
  const moderator = await requireRole(event, 'moderator')
  await rateLimitUser(event, RateLimits.moderation)
  const { id } = validParams(event, idParam)
  const input = await validBody(event, body)
  if (id === moderator.id) throw problem(422, 'validation_failed', 'You cannot ban yourself.')

  const prisma = usePrisma()
  const target = await prisma.profile.findUnique({ where: { id }, select: { role: true } })
  if (!target) throw notFound('User')
  if (hasRole(target, 'admin')) throw forbidden('Admins cannot be banned.')
  if (hasRole(target, 'moderator') && !hasRole(moderator, 'admin')) throw forbidden('Only admins can ban moderators.')

  const bannedUntil = input.until ? new Date(input.until) : INDEFINITE
  await prisma.profile.update({ where: { id }, data: { bannedUntil, banReason: input.reason ?? null } })

  log.info('user banned', { moderatorId: moderator.id, userId: id, bannedUntil: bannedUntil.toISOString() })
  return { userId: id, bannedUntil: bannedUntil.toISOString() }
})
