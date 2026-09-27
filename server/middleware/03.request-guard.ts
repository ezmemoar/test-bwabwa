const DEFAULT_LIMIT = 64 * 1024
/** Routes that legitimately carry more than the default. A year of check-ins with journals fits in 2 MB. */
const LARGE_BODIES: { prefix: string; limit: number }[] = [{ prefix: '/api/v1/journey', limit: 2 * 1024 * 1024 }]

const WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

// Rejects oversized, unsized or non-JSON bodies before anything reads them.
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/v1/') || !WITH_BODY.has(event.method)) return

  const path = event.path.split('?', 1)[0]!
  const limit = LARGE_BODIES.find((r) => path.startsWith(r.prefix))?.limit ?? DEFAULT_LIMIT
  const lengthHeader = getRequestHeader(event, 'content-length')
  const chunked = /chunked/i.test(getRequestHeader(event, 'transfer-encoding') ?? '')

  if (lengthHeader === undefined) {
    // Bodiless POSTs (e.g. an action endpoint) are fine; streamed bodies of unknown size are not.
    if (chunked) throw problem(411, 'bad_request', 'Content-Length is required.')
    return
  }
  const length = Number(lengthHeader)
  if (!Number.isSafeInteger(length) || length < 0) throw badRequest('Invalid Content-Length.')
  if (length > limit) throw problem(413, 'payload_too_large', `Request body must be at most ${limit} bytes.`, { limit })
  if (length === 0) return

  const type = getRequestHeader(event, 'content-type') ?? ''
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(type)) {
    throw problem(415, 'unsupported_media_type', 'Request bodies must be application/json.')
  }
})
