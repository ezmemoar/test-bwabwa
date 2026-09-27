defineRouteMeta({
  openAPI: {
    tags: ['forum'],
    summary: "Hide a person's posts and comments from me (idempotent)",
    security: [{ bearer: [] }],
  },
})

export default defineEventHandler(async (event) => {
  const me = await useProfile(event)
  await rateLimitWrite(event, RateLimits.block, RateLimits.blockIp)
  const { id } = validParams(event, idParam)
  if (id === me.id) throw problem(422, 'validation_failed', 'You cannot block yourself.')

  try {
    await usePrisma().userBlock.createMany({ data: [{ blockerId: me.id, blockedId: id }], skipDuplicates: true })
  } catch (error) {
    // Unknown user id: the FK to profiles fails.
    if (prismaCode(error) === FOREIGN_KEY_VIOLATION) throw notFound('User')
    throw error
  }
  return sendNoContent(event)
})
