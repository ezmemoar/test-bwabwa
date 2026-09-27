import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Sign in with Google',
    description:
      "Send the Google ID token from Android Credential Manager (requested with the Web client ID as server client ID and `setNonce(sha256(nonce))`) together with the raw `nonce`. Creates the account on first use. Send the device's anonymous access token as `Authorization: Bearer` to merge that anonymous account into it. The Google name and photo are not copied into the profile.",
  },
})

const body = z.object({
  /** A JWT: three base64url segments. Supabase does the real verification. */
  idToken: z
    .string()
    .max(4096)
    .regex(/^[\w-]+\.[\w-]+\.[\w-]+$/, 'must be a Google ID token'),
  /** The raw nonce; the token carries its SHA-256. Required, so a captured token can't be replayed. */
  nonce: z.string().min(16).max(256),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, RateLimits.authLoginIp, clientIp(event))
  const input = await validBody(event, body)

  const session = await supabaseSignInWithGoogle(input.idToken, input.nonce)

  const current = event.context.user
  const { merged } = current?.isAnonymous ? await adoptAnonymousAccount(current.id, session.user.id) : { merged: false }
  log.info('google sign-in', { userId: session.user.id, mergedFrom: merged ? current!.id : undefined })

  return { user: presentAuthUser(session.user), session: presentSession(session), mergedAnonymousAccount: merged }
})
