import { createError, type H3Error } from 'h3'

/**
 * Stable, machine-readable error codes. Clients branch on `code`, never on `detail` (which is for humans and
 * may change).
 */
export type ProblemCode =
  | 'bad_request'
  | 'invalid_json'
  | 'validation_failed'
  | 'unauthorized'
  | 'invalid_token'
  | 'forbidden'
  | 'banned'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'stale_snapshot'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'links_not_allowed'
  | 'email_taken'
  | 'weak_password'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'internal_error'
  | 'service_unavailable'

export interface ProblemData {
  code: ProblemCode
  /** Field-level problems for `validation_failed`. */
  errors?: { path: string; message: string }[]
  [key: string]: unknown
}

export function problem(status: number, code: ProblemCode, detail?: string, extra?: Omit<ProblemData, 'code'>): H3Error<ProblemData> {
  return createError<ProblemData>({
    statusCode: status,
    message: detail,
    data: { code, ...extra },
  })
}

export const badRequest = (detail?: string) => problem(400, 'bad_request', detail)
export const unauthorized = (detail = 'Authentication required.', code: ProblemCode = 'unauthorized') => problem(401, code, detail)
export const forbidden = (detail = 'You are not allowed to do this.') => problem(403, 'forbidden', detail)
export const notFound = (what = 'Resource') => problem(404, 'not_found', `${what} not found.`)
export const conflict = (detail: string, code: ProblemCode = 'conflict') => problem(409, code, detail)
