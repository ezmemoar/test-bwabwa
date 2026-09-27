import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PGlite } from '@electric-sql/pglite'
import { decodeJwt, SignJWT, type JWK } from 'jose'

// A stand-in for Supabase Auth (GoTrue) with the behaviour the API relies on: email/password sign-up (with an
// opt-in "confirm your email" path: any address containing "+confirm"), password and refresh-token grants
// (refresh tokens are single-use, like Supabase's), logout by scope, password recovery, the JWKS endpoint,
// and GoTrue's error shapes. Users are written to the test database's auth.users, as Supabase would.

export const ANON_KEY = 'test-anon-key'
export const GOOGLE_WEB_CLIENT_ID = 'test-web-client.apps.googleusercontent.com'
/** Stands in for Google's RS256 signature: tokens without it are "forged". */
export const GOOGLE_SIGNATURE = 'signed-by-google'

interface FakeUser {
  id: string
  email: string
  password: string
  confirmed: boolean
  metadata: Record<string, unknown>
}

export function createFakeSupabaseAuth(opts: { db: PGlite; privateKey: CryptoKey; kid: string; publicJwk: JWK; issuer: () => string }) {
  const users = new Map<string, FakeUser>()
  /** refresh token → { userId, sessionId } */
  const refreshTokens = new Map<string, { userId: string; sessionId: string }>()

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body))
  }
  const error = (res: ServerResponse, status: number, errorCode: string, msg: string, extra: Record<string, unknown> = {}) =>
    send(res, status, { code: status, error_code: errorCode, msg, ...extra })

  const userJson = (u: FakeUser) => ({
    id: u.id,
    email: u.email,
    is_anonymous: false,
    email_confirmed_at: u.confirmed ? new Date().toISOString() : null,
    user_metadata: u.metadata,
  })

  async function session(u: FakeUser) {
    const sessionId = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const accessToken = await new SignJWT({ role: 'authenticated', email: u.email, is_anonymous: false, session_id: sessionId, user_metadata: u.metadata })
      .setProtectedHeader({ alg: 'ES256', kid: opts.kid, typ: 'JWT' })
      .setSubject(u.id)
      .setIssuer(`${opts.issuer()}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(opts.privateKey)
    const refreshToken = randomBytes(18).toString('base64url')
    refreshTokens.set(refreshToken, { userId: u.id, sessionId })
    return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refreshToken, user: userJson(u) }
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    let raw = ''
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://fake')
    if (url.pathname === '/auth/v1/.well-known/jwks.json') return send(res, 200, { keys: [opts.publicJwk] })
    if (req.headers.apikey !== ANON_KEY) return send(res, 401, { message: 'Invalid API key' })
    if (req.method !== 'POST') return send(res, 405, { message: 'method not allowed' })
    const body = await readJson(req)

    switch (url.pathname) {
      case '/auth/v1/signup': {
        const email = String(body.email ?? '').toLowerCase()
        const password = String(body.password ?? '')
        if (password === 'password123') return error(res, 422, 'weak_password', 'Password is known to be weak and easy to guess', { weak_password: { reasons: ['pwned'] } })
        if (users.has(email)) return error(res, 422, 'user_already_exists', 'User already registered')
        const user: FakeUser = { id: randomUUID(), email, password, confirmed: !email.includes('+confirm'), metadata: (body.data as Record<string, unknown>) ?? {} }
        users.set(email, user)
        await opts.db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [user.id, email])
        return send(res, 200, user.confirmed ? await session(user) : userJson(user))
      }
      case '/auth/v1/token': {
        if (url.searchParams.get('grant_type') === 'password') {
          const user = users.get(String(body.email ?? '').toLowerCase())
          if (!user || user.password !== body.password) return error(res, 400, 'invalid_credentials', 'Invalid login credentials')
          if (!user.confirmed) return error(res, 400, 'email_not_confirmed', 'Email not confirmed')
          return send(res, 200, await session(user))
        }
        if (url.searchParams.get('grant_type') === 'id_token') {
          // Google ID tokens: checked the way Supabase does (audience, signature, expiry, sha256(nonce)).
          if (body.provider !== 'google') return error(res, 400, 'validation_failed', 'Unsupported provider')
          const [, payloadPart, signature] = String(body.id_token ?? '').split('.')
          const claims = payloadPart ? JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) : {}
          const valid =
            signature === GOOGLE_SIGNATURE &&
            claims.aud === GOOGLE_WEB_CLIENT_ID &&
            claims.exp > Date.now() / 1000 &&
            claims.nonce === createHash('sha256').update(String(body.nonce ?? '')).digest('hex')
          if (!valid) return error(res, 400, 'validation_failed', 'Bad ID token')
          const key = `google:${claims.sub}`
          let user = users.get(key)
          if (!user) {
            user = { id: randomUUID(), email: claims.email, password: '', confirmed: true, metadata: { full_name: claims.name } }
            users.set(key, user)
            await opts.db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [user.id, claims.email])
          }
          return send(res, 200, await session(user))
        }
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const entry = refreshTokens.get(String(body.refresh_token ?? ''))
          if (!entry) return error(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
          refreshTokens.delete(String(body.refresh_token))
          const user = [...users.values()].find((u) => u.id === entry.userId)!
          return send(res, 200, await session(user))
        }
        return error(res, 400, 'validation_failed', 'unsupported grant_type')
      }
      case '/auth/v1/logout': {
        const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
        const claims = decodeJwt(token)
        const scope = url.searchParams.get('scope') ?? 'global'
        for (const [rt, entry] of refreshTokens) {
          if (entry.userId !== claims.sub) continue
          const current = entry.sessionId === claims.session_id
          if (scope === 'global' || (scope === 'local' && current) || (scope === 'others' && !current)) refreshTokens.delete(rt)
        }
        return send(res, 204)
      }
      case '/auth/v1/recover':
        return send(res, 200, {})
      default:
        return send(res, 404, { message: 'not found' })
    }
  }
}
