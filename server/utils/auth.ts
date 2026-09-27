import type { H3Event } from 'h3'
import { createRemoteJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose'

export interface AuthUser {
  id: string
  /** Supabase anonymous sign-in: a real account without an email yet. */
  isAnonymous: boolean
  sessionId: string | null
  email: string | null
  /** The username chosen at registration (Supabase user metadata). Untrusted: re-validated before use. */
  metadataUsername: unknown
}

declare module 'h3' {
  interface H3EventContext {
    requestId: string
    startedAt: number
    /** Set by the auth middleware: a verified user, or null when no Authorization header was sent. */
    user?: AuthUser | null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let jwks: JWTVerifyGetKey | undefined
let hsKey: Uint8Array | undefined

function remoteKeys(): JWTVerifyGetKey {
  // jose caches the key set and refetches (rate-limited by the cooldown) when it meets an unknown `kid`,
  // so key rotation in Supabase needs no restart.
  jwks ??= createRemoteJWKSet(new URL(`${useConfig().supabase.url}/auth/v1/.well-known/jwks.json`), {
    cacheMaxAge: 10 * 60_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  })
  return jwks
}

const invalidToken = () => unauthorized('Invalid access token.', 'invalid_token')

/**
 * Verifies a Supabase access token locally: no network round trip per request. Asymmetric keys (ES256/RS256)
 * come from the project's JWKS; HS256 is accepted only when the legacy secret is configured, which keeps
 * algorithm-confusion attacks off the table.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { url: supabaseUrl, jwtSecret: supabaseJwtSecret } = useConfig().supabase
  let alg: string | undefined
  try {
    alg = decodeProtectedHeader(token).alg
  } catch {
    throw invalidToken()
  }

  const options = { issuer: `${supabaseUrl}/auth/v1`, audience: 'authenticated', clockTolerance: 5 }
  let payload
  try {
    if (alg === 'HS256') {
      if (!supabaseJwtSecret) throw invalidToken()
      hsKey ??= new TextEncoder().encode(supabaseJwtSecret)
      ;({ payload } = await jwtVerify(token, hsKey, { ...options, algorithms: ['HS256'] }))
    } else {
      ;({ payload } = await jwtVerify(token, remoteKeys(), { ...options, algorithms: ['ES256', 'RS256', 'EdDSA'] }))
    }
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) throw unauthorized('Access token expired.', 'invalid_token')
    if (error instanceof joseErrors.JWKSTimeout || (error instanceof TypeError && /fetch/i.test(error.message))) {
      log.error('jwks unavailable', serializeError(error))
      throw problem(503, 'service_unavailable', 'Authentication is temporarily unavailable.')
    }
    if (isError(error)) throw error
    throw invalidToken()
  }

  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !UUID.test(payload.sub)) throw invalidToken()
  return {
    id: payload.sub,
    isAnonymous: payload.is_anonymous === true,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
    email: typeof payload.email === 'string' && payload.email ? payload.email : null,
    metadataUsername: (payload.user_metadata as Record<string, unknown> | undefined)?.username,
  }
}

export function bearerToken(event: H3Event): string | null | undefined {
  const header = getRequestHeader(event, 'authorization')
  if (header === undefined) return undefined
  const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header.trim())
  return match ? match[1] : null
}

/** The verified caller, or 401. */
export function requireUser(event: H3Event): AuthUser {
  const user = event.context.user
  if (!user) throw unauthorized()
  return user
}
