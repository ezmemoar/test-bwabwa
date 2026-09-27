defineRouteMeta({
  openAPI: { tags: ['forum'], summary: 'Delete a post (its author, or a moderator)', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const viewer = await useProfile(event)
  const { id } = validParams(event, idParam)
  const prisma = usePrisma()

  const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true, removedAt: true } })
  if (!post || post.removedAt) throw notFound('Post')
  if (post.authorId !== viewer.id && !hasRole(viewer, 'moderator')) throw forbidden('Only the author or a moderator can delete this post.')

  await prisma.$transaction((tx) => removeTarget(tx, { type: 'post', id }))
  return sendNoContent(event)
})
