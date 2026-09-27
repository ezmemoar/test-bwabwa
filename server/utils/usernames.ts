import { z } from 'zod'

/**
 * A username as the API accepts it: 2–24 characters after cleaning, no links, and not staff-sounding unless
 * the caller is staff. The same rules apply whether it arrives with registration, through PATCH /me, or via
 * Supabase user metadata (which users can edit directly, so it is never trusted as-is).
 */
export const usernameField = z.union([z.literal(''), z.null(), cleanText(2, 24)]).transform((v) => (v ? v : null))

export type UsernameProblem = 'links_not_allowed' | 'reserved'

export function usernameProblem(name: string, isStaff: boolean): UsernameProblem | null {
  if (containsLink(name)) return 'links_not_allowed'
  if (!isStaff && isReservedName(name)) return 'reserved'
  return null
}

/** Throws the API's 422 for a username that fails the content rules. */
export function assertUsernameAllowed(name: string | null, isStaff: boolean, field = 'username') {
  if (!name) return
  const issue = usernameProblem(name, isStaff)
  if (issue === 'links_not_allowed') throw problem(422, 'links_not_allowed', 'Links are not allowed in usernames.')
  if (issue === 'reserved') throw problem(422, 'validation_failed', 'That name is reserved.', { errors: [{ path: field, message: 'is reserved' }] })
}

/** A username from somewhere untrusted (auth metadata): the cleaned value if it passes every rule, else null. */
export function acceptableUsername(raw: unknown): string | null {
  const parsed = usernameField.safeParse(raw)
  if (!parsed.success || !parsed.data) return null
  return usernameProblem(parsed.data, false) ? null : parsed.data
}
