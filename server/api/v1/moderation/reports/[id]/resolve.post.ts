import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['moderation'],
    summary: 'Resolve a report (moderators)',
    description:
      '`remove` deletes the content, `restore` un-hides it and clears its report count, `dismiss` leaves it as is. Every open report on the same target is closed with the same outcome.',
    security: [{ bearer: [] }],
  },
})

const body = z.object({ action: z.enum(['dismiss', 'remove', 'restore']) })

export default defineEventHandler(async (event) => {
  const moderator = await requireRole(event, 'moderator')
  await rateLimitUser(event, RateLimits.moderation)
  const { id } = validParams(event, idParam)
  const { action } = await validBody(event, body)
  const prisma = usePrisma()

  const report = await prisma.report.findUnique({ where: { id } })
  if (!report) throw notFound('Report')
  const target = { type: report.targetType, id: report.targetId }

  const { count } = await prisma.$transaction(async (tx) => {
    if (action === 'remove') await removeTarget(tx, target)
    if (action === 'restore') await restoreTarget(tx, target)
    return tx.report.updateMany({
      where: { targetType: target.type, targetId: target.id, status: 'open' },
      data: { status: action === 'remove' ? 'actioned' : 'dismissed', resolvedBy: moderator.id, resolvedAt: new Date() },
    })
  })

  log.info('report resolved', { moderatorId: moderator.id, reportId: id, action, target, closed: count })
  return { action, closedReports: count }
})
