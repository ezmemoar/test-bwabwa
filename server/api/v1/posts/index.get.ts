import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['forum'],
    summary: 'The forum feed, newest first (keyset pagination)',
    parameters: [
      { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      { in: 'query', name: 'cursor', schema: { type: 'string' }, description: '`nextCursor` from the previous page' },
    ],
    security: [{ bearer: [] }],
  },
})

const query = z.object({ limit: pageLimit(20, 50), cursor: z.string().max(200).optional() })

export default defineEventHandler(async (event) => {
  const me = requireUser(event)
  const { limit, cursor: rawCursor } = validQuery(event, query)
  const cursor = decodeCursor(rawCursor)

  const rows = await usePrisma().post.findMany({
    where: {
      removedAt: null,
      hiddenAt: null,
      // Hidden people ("Hide posts from this person") never appear.
      author: { blockedBy: { none: { blockerId: me.id } } },
      // Keyset: strictly after the last row of the previous page in (created_at DESC, id DESC) order.
      ...(cursor && {
        OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
      }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: postSelect,
  })

  const page = paginate(rows, limit)
  return { data: page.rows.map((p) => presentPost(p, me.id)), nextCursor: page.nextCursor }
})
