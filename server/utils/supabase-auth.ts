import { ofetch, type FetchError } from 'ofetch'

// Supabase Auth (GoTrue) over its REST API, with the project's publishable (anon) key: what supabase-js does,
// minus the client-side session handling the server doesn't need. Every failure becomes an API problem with
// a stable code; GoTrue's own messages and codes never leak through unmapped.

export interface GoTrueUser {
  id: string
  email?: string | null
  is_anonymous?: boolean
  email_confirmed_at?: string | null
  user_metadata?: Record<string, unknown>
}

export interface GoTrueSession {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  expires_at?: number
  user: GoTrueUser
}

interface GoTrueErrorBody {
  code?: number | string
  error_code?: string
  msg?: string
  message?: string
  error?: string
  error_description?: string
  weak_password?: { reasons?: string[] }
}

function authConfig() {
  const { url, anonKey } = useConfig().supabase
  if (!anonKey) throw problem(503, 'service_unavailable', 'Sign-in is not configured on this server.')
  return { url, anonKey }
}

function mapGoTrueError(status: number, body: GoTrueErrorBody): never {
  const code = body.error_code ?? (typeof body.code === 'string' ? body.code : undefined) ?? body.error
  switch (code) {
    case 'user_already_exists':
    case 'email_exists':
      throw problem(409, 'email_taken', 'An account with this email already exists.')
    case 'weak_password':
      throw problem(422, 'weak_password', 'Choose a stronger password.', { reasons: body.weak_password?.reasons ?? [] })
    case 'invalid_credentials':
    case 'invalid_grant':
      if (/refresh token/i.test(body.error_description ?? body.msg ?? '')) throw unauthorized('Session expired. Sign in again.', 'invalid_token')
      throw problem(401, 'invalid_credentials', 'Email or password is incorrect.')
    case 'email_not_confirmed':
      throw problem(403, 'email_not_confirmed', 'Confirm your email address first. Check your inbox.')
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'session_not_found':
    case 'session_expired':
    case 'bad_jwt':
      throw unauthorized('Session expired. Sign in again.', 'invalid_token')
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      throw problem(429, 'rate_limited', 'Too many attempts. Try again later.')
    case 'signup_disabled':
    case 'email_provider_disabled':
      throw problem(403, 'forbidden', 'Signing up with email is disabled.')
    case 'provider_disabled':
      throw problem(403, 'forbidden', 'This sign-in method is disabled.')
    case 'email_address_invalid':
    case 'email_address_not_authorized':
    case 'validation_failed':
      throw problem(422, 'validation_failed', 'That email address cannot be used.', { errors: [{ path: 'email', message: 'is not accepted' }] })
  }
  if (status === 429) throw problem(429, 'rate_limited', 'Too many attempts. Try again later.')
  log.error('supabase auth error', { status, code, message: body.msg ?? body.message ?? body.error_description })
  if (status >= 500) throw problem(503, 'service_unavailable', 'Sign-in is temporarily unavailable.')
  throw problem(400, 'bad_request', 'The sign-in request was rejected.')
}

interface GoTrueCall {
  body?: unknown
  accessToken?: string
  query?: Record<string, string>
  /** Runs before the generic mapping; throw to replace it for this call, return to fall through. */
  onError?: (status: number, body: GoTrueErrorBody) => void
}

async function gotrue<T>(path: string, init: GoTrueCall = {}): Promise<T> {
  const { url, anonKey } = authConfig()
  try {
    return (await ofetch(`/auth/v1${path}`, {
      baseURL: url,
      method: 'POST',
      query: init.query,
      body: init.body ?? {},
      headers: { apikey: anonKey, Authorization: `Bearer ${init.accessToken ?? anonKey}` },
      timeout: 10_000,
      retry: 0,
    })) as T
  } catch (error) {
    const e = error as FetchError<GoTrueErrorBody>
    if (e.statusCode === undefined) {
      log.error('supabase auth unreachable', serializeError(error))
      throw problem(503, 'service_unavailable', 'Sign-in is temporarily unavailable.')
    }
    init.onError?.(e.statusCode, e.data ?? {})
    return mapGoTrueError(e.statusCode, e.data ?? {})
  }
}

/** Email/password sign-up. Without a session in the answer, the project wants the email confirmed first. */
export function supabaseSignUp(email: string, password: string, username: string | null) {
  return gotrue<GoTrueSession | GoTrueUser>('/signup', { body: { email, password, data: username ? { username } : {} } })
}

export function supabaseSignIn(email: string, password: string) {
  return gotrue<GoTrueSession>('/token', { query: { grant_type: 'password' }, body: { email, password } })
}

/**
 * Sign in with a Google ID token obtained on the device (Android Credential Manager). Supabase Auth verifies
 * the token's signature and audience (the client IDs configured for its Google provider) and that
 * sha256(nonce) matches the token's `nonce` claim, then creates or finds the user and returns a session.
 */
export function supabaseSignInWithGoogle(idToken: string, nonce: string) {
  return gotrue<GoTrueSession>('/token', {
    query: { grant_type: 'id_token' },
    body: { provider: 'google', id_token: idToken, nonce },
    onError(status, body) {
      const code = body.error_code ?? body.error
      // Provider switched off, rate limits and outages keep their generic meaning...
      if (code === 'provider_disabled' || status === 429 || status >= 500) return
      // ...every rejected token (expired, wrong audience, nonce mismatch, forged) is one answer to the client.
      throw problem(401, 'invalid_credentials', 'Google sign-in could not be verified. Try again.')
    },
  })
}

export function supabaseRefresh(refreshToken: string) {
  return gotrue<GoTrueSession>('/token', { query: { grant_type: 'refresh_token' }, body: { refresh_token: refreshToken } })
}

/** Revokes refresh tokens: this session (`local`), every session (`global`) or every other one (`others`). */
export async function supabaseSignOut(accessToken: string, scope: 'local' | 'global' | 'others') {
  try {
    await gotrue<void>('/logout', { accessToken, query: { scope } })
  } catch (error) {
    // Already signed out (expired or revoked session): the outcome the caller wanted.
    if ((error as { data?: { code?: string } }).data?.code === 'invalid_token') return
    throw error
  }
}

/** Sends the password-reset email. Supabase answers the same whether or not the address has an account. */
export function supabaseRecover(email: string) {
  return gotrue<unknown>('/recover', { body: { email } })
}

export function isSession(value: GoTrueSession | GoTrueUser): value is GoTrueSession {
  return typeof (value as GoTrueSession).access_token === 'string'
}

export function presentSession(s: GoTrueSession) {
  return {
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    tokenType: 'bearer' as const,
    expiresIn: s.expires_in,
    expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in,
  }
}

export function presentAuthUser(u: GoTrueUser) {
  return {
    id: u.id,
    email: u.email ?? null,
    isAnonymous: u.is_anonymous === true,
    emailConfirmed: Boolean(u.email_confirmed_at),
  }
}
