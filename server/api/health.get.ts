defineRouteMeta({
  openAPI: {
    tags: ['health'],
    summary: 'Liveness: the process is up',
    $global: {
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', description: 'Supabase access token (JWT)' },
        },
      },
    },
  },
})

export default defineEventHandler(() => ({ status: 'ok' }))
