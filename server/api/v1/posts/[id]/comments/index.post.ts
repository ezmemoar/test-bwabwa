import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['forum'],
    summary: 'Comment on a post',
    description: 'Like posts, a client-generated `id` makes retries idempotent.',
    security: [{ bearer: [] }],
  },
})

const body = z.object({
  id: z.uuid().optional(),
  body: cleanText(1, 500),
})

export default defineEventHandler(async (event) => {
  const profile = await requireActiveMember(event)
  await rateLimitWrite(event, RateLimits.commentCreate, RateLimits.commentCreateIp)
  const { id: postId } = validParams(event, idParam)
  const input = await validBody(event, body)
  assertNoLinks(input.body)

  const post = await findReadablePost(postId, profile)
  // Hidden posts are readable by their author but closed to new comments.
  if (!post || post.hiddenAt) throw notFound('Post')

  const prisma = usePrisma()
  const created = await prisma.$transaction((tx) =>
    insertComment(tx, {
      id: input.id,
      postId,
      authorId: profile.id,
      authorName: profile.username ?? ANONYMOUS_NAME,
      body: input.body,
    }),
  )

  if (created) {
    setResponseStatus(event, 201)
    return presentComment(created, profile.id)
  }

  const existing = await prisma.comment.findUnique({ where: { id: input.id! }, select: commentSelect })
  if (!existing || existing.authorId !== profile.id || existing.postId !== postId) throw conflict('A comment with this id already exists.')
  return presentComment(existing, profile.id)
})
