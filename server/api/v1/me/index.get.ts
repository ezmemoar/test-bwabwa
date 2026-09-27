defineRouteMeta({
  openAPI: { tags: ['me'], summary: 'The signed-in user; creates their profile on first call', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const profile = await useProfile(event)
  return presentMe(profile, requireUser(event))
})
