defineRouteMeta({
  openAPI: { tags: ['forum'], summary: 'Stop hiding a person (idempotent)', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const me = requireUser(event)
  await rateLimitWrite(event, RateLimits.block, RateLimits.blockIp)
  const { id } = validParams(event, idParam)
  await usePrisma().userBlock.deleteMany({ where: { blockerId: me.id, blockedId: id } })
  return sendNoContent(event)
})
