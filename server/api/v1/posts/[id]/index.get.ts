defineRouteMeta({
  openAPI: { tags: ['forum'], summary: 'One post', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const viewer = await useProfile(event)
  const { id } = validParams(event, idParam)
  const post = await findReadablePost(id, viewer)
  if (!post) throw notFound('Post')
  return presentPost(post, viewer.id)
})
