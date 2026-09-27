import type { NitroErrorHandler } from 'nitropack'
import type { ProblemCode, ProblemData } from '~~/server/utils/problem'

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  411: 'Length Required',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

const DEFAULT_CODES: Record<number, ProblemCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  503: 'service_unavailable',
}

/**
 * Every error leaves as RFC 9457 `application/problem+json`, with a stable `code` and the request id. Errors
 * raised on purpose (through `problem()`, which always sets a code) keep their detail; anything unexpected is
 * logged in full and answered generically, so stack traces and SQL stay on the server.
 */
export default <NitroErrorHandler>function errorHandler(error, event) {
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
  const data = (error.data ?? {}) as Partial<ProblemData>
  const deliberate = typeof data.code === 'string'
  const code: ProblemCode = data.code ?? DEFAULT_CODES[status] ?? (status >= 500 ? 'internal_error' : 'bad_request')
  const requestId = event.context.requestId ?? getResponseHeader(event, 'x-request-id')
  const unexpected = status >= 500 && !deliberate

  logRequest(event, status, status >= 500 ? { code, ...serializeError(error.cause ?? error) } : { code })

  const { code: _code, ...extra } = data
  const body = {
    type: 'about:blank',
    title: TITLES[status] ?? (status >= 500 ? 'Server Error' : 'Error'),
    status,
    code,
    detail: unexpected ? 'Something went wrong on our side.' : error.message || error.statusMessage || undefined,
    requestId,
    ...(unexpected ? {} : extra),
  }

  if (status === 401) setResponseHeader(event, 'WWW-Authenticate', `Bearer error="${code === 'invalid_token' ? 'invalid_token' : 'invalid_request'}"`)
  setResponseHeader(event, 'Content-Type', 'application/problem+json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, status)
  return send(event, JSON.stringify(body))
}
