import { randomUUID } from 'node:crypto'

const INBOUND_ID = /^[A-Za-z0-9._-]{8,128}$/

// Request id, timing and the response headers every API answer carries.
export default defineEventHandler((event) => {
  event.context.startedAt = performance.now()
  const inbound = getRequestHeader(event, 'x-request-id')
  event.context.requestId = inbound && INBOUND_ID.test(inbound) ? inbound : randomUUID()

  setResponseHeaders(event, {
    'X-Request-Id': event.context.requestId,
    // JSON API: nothing here should be cached by shared caches, sniffed, framed or leak a referrer.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-site',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  })
})
