// Boot-time config check, access logging for successful requests, and a clean shutdown of pools and sockets.
export default defineNitroPlugin((nitroApp) => {
  try {
    useConfig()
  } catch (error) {
    // Fail at boot rather than on the first request.
    console.error((error as Error).message)
    process.exit(1)
  }

  // Failed requests are logged by the error handler.
  nitroApp.hooks.hook('afterResponse', (event) => logRequest(event, getResponseStatus(event)))

  nitroApp.hooks.hook('close', async () => {
    await Promise.allSettled([closePrisma(), closeRateLimitStore()])
  })
})
