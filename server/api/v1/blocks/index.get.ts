defineRouteMeta({
  openAPI: { tags: ['forum'], summary: 'People whose posts and comments I have hidden', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const me = requireUser(event)
  const rows = await usePrisma().userBlock.findMany({
    where: { blockerId: me.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { blockedId: true, createdAt: true },
  })
  return { data: rows.map((r) => ({ userId: r.blockedId, createdAt: r.createdAt.toISOString() })) }
})
