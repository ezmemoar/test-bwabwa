defineRouteMeta({
  openAPI: { tags: ['forum'], summary: 'Delete a comment (its author, or a moderator)', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const viewer = await useProfile(event)
  const { id } = validParams(event, idParam)
  const prisma = usePrisma()

  const comment = await prisma.comment.findUnique({ where: { id }, select: { authorId: true, removedAt: true } })
  if (!comment || comment.removedAt) throw notFound('Comment')
  if (comment.authorId !== viewer.id && !hasRole(viewer, 'moderator')) throw forbidden('Only the author or a moderator can delete this comment.')

  await prisma.$transaction((tx) => removeTarget(tx, { type: 'comment', id }))
  return sendNoContent(event)
})
