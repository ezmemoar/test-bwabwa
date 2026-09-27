defineRouteMeta({
  openAPI: { tags: ['moderation'], summary: 'Lift a ban (moderators)', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const moderator = await requireRole(event, 'moderator')
  await rateLimitUser(event, RateLimits.moderation)
  const { id } = validParams(event, idParam)

  const prisma = usePrisma()
  const target = await prisma.profile.findUnique({ where: { id }, select: { role: true } })
  if (!target) throw notFound('User')
  // Same rule as banning: only admins decide about moderators.
  if (hasRole(target, 'moderator') && !hasRole(moderator, 'admin')) throw forbidden('Only admins can lift a ban on a moderator.')

  await prisma.profile.update({ where: { id }, data: { bannedUntil: null, banReason: null } })

  log.info('user unbanned', { moderatorId: moderator.id, userId: id })
  return sendNoContent(event)
})
