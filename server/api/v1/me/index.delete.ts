defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Delete the account and everything stored for it',
    description: 'Deletes the Supabase auth user (which cascades to every row the API keeps) and then the profile. Irreversible.',
    security: [{ bearer: [] }],
  },
})

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  await rateLimitUser(event, RateLimits.accountDelete)
  const { url: supabaseUrl, secretKey: supabaseSecretKey } = useConfig().supabase

  if (supabaseSecretKey) {
    try {
      await $fetch(`/auth/v1/admin/users/${user.id}`, {
        baseURL: supabaseUrl,
        method: 'DELETE',
        headers: { apikey: supabaseSecretKey, Authorization: `Bearer ${supabaseSecretKey}` },
        timeout: 10_000,
        retry: 1,
      })
    } catch (error) {
      // 404: the auth user is already gone; carry on and clean up our side.
      if ((error as { statusCode?: number }).statusCode !== 404) {
        log.error('auth user deletion failed', { userId: user.id, ...serializeError(error) })
        throw problem(503, 'service_unavailable', 'Account deletion is temporarily unavailable. Nothing was deleted.')
      }
    }
  } else {
    log.warn('NUXT_SUPABASE_SECRET_KEY is not set: deleting API data only, the auth user remains', { userId: user.id })
  }

  // Normally a no-op (the FK to auth.users already cascaded); covers setups without the secret key.
  await usePrisma().profile.deleteMany({ where: { id: user.id } })
  log.info('account deleted', { userId: user.id })
  return sendNoContent(event)
})
