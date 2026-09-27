import { randomUUID } from 'node:crypto'
import { generateKeyPair, importJWK, SignJWT } from 'jose'
import { inject } from 'vitest'
import { JWT_SECRET, USERS } from './global-setup'

export { USERS }
export type UserName = keyof typeof USERS

let signingKey: CryptoKey | Uint8Array | undefined

interface TokenOptions {
  aud?: string
  iss?: string
  exp?: number
  role?: string
  /** Sign with the legacy HS256 secret (or this one) instead of the project's ES256 key. */
  hs256?: boolean | string
  /** Sign with a fresh ES256 key the JWKS doesn't know. */
  unknownKey?: boolean
}

/** A Supabase-shaped access token, ES256-signed like current projects. Override claims to break it. */
export async function token(user: UserName | string, o: TokenOptions = {}) {
  const now = Math.floor(Date.now() / 1000)
  const jwt = new SignJWT({ role: o.role ?? 'authenticated', is_anonymous: true, session_id: randomUUID() })
    .setSubject(user in USERS ? USERS[user as UserName] : user)
    .setIssuer(o.iss ?? `${inject('supabaseUrl')}/auth/v1`)
    .setAudience(o.aud ?? 'authenticated')
    .setIssuedAt(now)
    .setExpirationTime(o.exp ?? now + 3600)

  if (o.hs256) {
    const secret = typeof o.hs256 === 'string' ? o.hs256 : JWT_SECRET
    return jwt.setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(new TextEncoder().encode(secret))
  }
  if (o.unknownKey) {
    const { privateKey } = await generateKeyPair('ES256')
    return jwt.setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-key-1' }).sign(privateKey)
  }
  const jwk = inject('signingKey')
  signingKey ??= await importJWK(jwk, 'ES256')
  return jwt.setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: jwk.kid }).sign(signingKey)
}

export interface ApiResponse<T = any> {
  status: number
  headers: Headers
  body: T
}

export async function api<T = any>(
  method: string,
  path: string,
  opts: { as?: UserName | string; ip?: string; token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string } = {},
): Promise<ApiResponse<T>> {
  // Each test user gets its own client IP so the per-IP limit only trips where a test wants it to.
  const ip = opts.ip ?? (opts.as ? `10.0.0.${Object.keys(USERS).indexOf(opts.as) + 1}` : '10.0.1.1')
  const headers: Record<string, string> = { 'x-forwarded-for': ip, ...opts.headers }
  const bearer = opts.token ?? (opts.as ? await token(opts.as) : undefined)
  if (bearer) headers.authorization = `Bearer ${bearer}`
  let body: string | undefined = opts.rawBody
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['content-type'] ??= 'application/json'
  }
  const res = await fetch(`${inject('baseUrl')}${path}`, { method, headers, body })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // leave as text
  }
  return { status: res.status, headers: res.headers, body: parsed as T }
}

export const uuid = () => randomUUID()
