import { z } from 'zod'
import { ReportReason } from '~~/server/generated/prisma/enums'

defineRouteMeta({
  openAPI: {
    tags: ['forum'],
    summary: 'Report a post or comment',
    description: `Always answers 202. Reporting the same thing twice is a no-op. Content is hidden automatically once enough different people report it.`,
    security: [{ bearer: [] }],
  },
})

const body = z.object({
  targetType: z.enum(['post', 'comment']),
  targetId: z.uuid(),
  reason: z.enum(ReportReason),
  details: cleanText(0, 500).nullish(),
})

export default defineEventHandler(async (event) => {
  const reporter = await useProfile(event)
  await rateLimitWrite(event, RateLimits.report, RateLimits.reportIp)
  const input = await validBody(event, body)
  const prisma = usePrisma()

  const where = { id: input.targetId, removedAt: null }
  const select = { authorId: true }
  const target = input.targetType === 'post' ? await prisma.post.findFirst({ where, select }) : await prisma.comment.findFirst({ where, select })
  if (!target) throw notFound(input.targetType === 'post' ? 'Post' : 'Comment')

  // Reporting your own content does nothing (and says nothing different).
  if (target.authorId !== reporter.id) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.report.createMany({
        data: [{ reporterId: reporter.id, targetType: input.targetType, targetId: input.targetId, reason: input.reason, details: input.details || null }],
        // The unique (reporter, target) index turns a repeat report into a no-op.
        skipDuplicates: true,
      })
      if (count > 0) await registerReport(tx, { type: input.targetType, id: input.targetId })
    })
  }

  setResponseStatus(event, 202)
  return { status: 'received' }
})
