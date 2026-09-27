import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['forum'],
    summary: "A post's comments, oldest first (keyset pagination)",
    parameters: [
      { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      { in: 'query', name: 'cursor', schema: { type: 'string' } },
    ],
    security: [{ bearer: [] }],
  },
})

const query = z.object({ limit: pageLimit(50, 100), cursor: z.string().max(200).optional() })

export default defineEventHandler(async (event) => {
  const viewer = await useProfile(event)
  const { id: postId } = validParams(event, idParam)
  const { limit, cursor: rawCursor } = validQuery(event, query)
  const cursor = decodeCursor(rawCursor)
  if (!(await findReadablePost(postId, viewer))) throw notFound('Post')
  const moderator = hasRole(viewer, 'moderator')

  const rows = await usePrisma().comment.findMany({
    where: {
      postId,
      removedAt: null,
      author: { blockedBy: { none: { blockerId: viewer.id } } },
      AND: [
        // Hidden comments stay visible to their author and to moderators.
        moderator ? {} : { OR: [{ hiddenAt: null }, { authorId: viewer.id }] },
        cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {},
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: commentSelect,
  })

  const page = paginate(rows, limit)
  return { data: page.rows.map((c) => presentComment(c, viewer.id)), nextCursor: page.nextCursor }
})
