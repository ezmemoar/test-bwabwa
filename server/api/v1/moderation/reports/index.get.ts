import { z } from 'zod'
import { ReportStatus } from '~~/server/generated/prisma/enums'

defineRouteMeta({
  openAPI: {
    tags: ['moderation'],
    summary: 'Report queue (moderators)',
    parameters: [
      { in: 'query', name: 'status', schema: { type: 'string', enum: Object.values(ReportStatus), default: 'open' } },
      { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      { in: 'query', name: 'cursor', schema: { type: 'string' } },
    ],
    security: [{ bearer: [] }],
  },
})

const query = z.object({
  status: z.enum(ReportStatus).default('open'),
  limit: pageLimit(50, 100),
  cursor: z.string().max(200).optional(),
})

const targetSelect = { id: true, body: true, authorId: true, authorName: true, hiddenAt: true, removedAt: true, reportCount: true } as const

export default defineEventHandler(async (event) => {
  await requireRole(event, 'moderator')
  await rateLimitUser(event, RateLimits.moderation)
  const { status, limit, cursor: rawCursor } = validQuery(event, query)
  const cursor = decodeCursor(rawCursor)
  const prisma = usePrisma()

  const rows = await prisma.report.findMany({
    where: {
      status,
      ...(cursor && {
        OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
      }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const page = paginate(rows, limit)

  // Targets are polymorphic (post or comment): load each kind in one query instead of one per report.
  const idsOf = (type: 'post' | 'comment') => page.rows.filter((r) => r.targetType === type).map((r) => r.targetId)
  const [posts, comments] = await Promise.all([
    prisma.post.findMany({ where: { id: { in: idsOf('post') } }, select: targetSelect }),
    prisma.comment.findMany({ where: { id: { in: idsOf('comment') } }, select: targetSelect }),
  ])
  const targets = new Map([...posts, ...comments].map((t) => [t.id, t]))

  return {
    data: page.rows.map((r) => {
      const t = targets.get(r.targetId)
      return {
        id: r.id,
        status: r.status,
        reason: r.reason,
        details: r.details,
        reporterId: r.reporterId,
        createdAt: r.createdAt.toISOString(),
        target: {
          type: r.targetType,
          id: r.targetId,
          body: t?.body ?? null,
          authorId: t?.authorId ?? null,
          authorName: t?.authorName ?? null,
          reportCount: t?.reportCount ?? 0,
          hiddenAt: t?.hiddenAt?.toISOString() ?? null,
          removedAt: t?.removedAt?.toISOString() ?? null,
        },
      }
    }),
    nextCursor: page.nextCursor,
  }
})
