defineRouteMeta({
  openAPI: { tags: ['health'], summary: 'Readiness: the database answers' },
})

export default defineEventHandler(async () => {
  const started = performance.now()
  try {
    await usePrisma().$queryRaw`SELECT 1`
  } catch (error) {
    log.error('readiness check failed', serializeError(error))
    throw problem(503, 'service_unavailable', 'Database unavailable.')
  }
  return { status: 'ok', db: { latencyMs: Math.round((performance.now() - started) * 10) / 10 } }
})
