import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['forum'],
    summary: 'Create a post',
    description:
      'Send a client-generated UUID as `id` to make retries safe: repeating the same request returns the original post with 200 instead of creating a duplicate.',
    security: [{ bearer: [] }],
  },
})

const body = z.object({
  id: z.uuid().optional(),
  body: cleanText(10, 1000),
  /** The author's current streak, shown next to their name. Self-reported. */
  streakDays: z.int().min(0).max(36_500).default(0),
})

export default defineEventHandler(async (event) => {
  const profile = await requireActiveMember(event)
  await rateLimitWrite(event, RateLimits.postCreate, RateLimits.postCreateIp)
  const input = await validBody(event, body)
  assertNoLinks(input.body)
  const prisma = usePrisma()

  // INSERT ... ON CONFLICT DO NOTHING: an empty result means the id already exists.
  const [created] = await prisma.post.createManyAndReturn({
    data: [
      {
        id: input.id,
        authorId: profile.id,
        authorName: profile.username ?? ANONYMOUS_NAME,
        authorStreakDays: input.streakDays,
        body: input.body,
      },
    ],
    skipDuplicates: true,
    select: postSelect,
  })

  if (created) {
    setResponseStatus(event, 201)
    setResponseHeader(event, 'Location', `/api/v1/posts/${created.id}`)
    return presentPost(created, profile.id)
  }

  // An idempotent replay of our own request, or someone else's id.
  const existing = await prisma.post.findUnique({ where: { id: input.id! }, select: postSelect })
  if (!existing || existing.authorId !== profile.id) throw conflict('A post with this id already exists.')
  return presentPost(existing, profile.id)
})
