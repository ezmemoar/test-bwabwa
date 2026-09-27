import type { H3Event } from 'h3'
import type { Profile, UserRole } from '~~/server/generated/prisma/client'

declare module 'h3' {
  interface H3EventContext {
    profile?: Profile
  }
}

/**
 * The caller's profile, created on first use and cached on the event, so handlers can call it freely.
 * A still-valid token whose Supabase account was deleted is treated as an invalid token.
 */
export async function useProfile(event: H3Event): Promise<Profile> {
  if (event.context.profile) return event.context.profile
  const user = requireUser(event)
  const prisma = usePrisma()

  let profile = await prisma.profile.findUnique({ where: { id: user.id } })
  if (!profile) {
    // Tokens stay valid for up to an hour after an account is deleted: never resurrect a profile for one.
    const [account] = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM auth.users WHERE id = ${user.id}::uuid`
    if (!account) throw unauthorized('This account no longer exists.', 'invalid_token')
    try {
      // A username picked at registration travels in the token's user metadata; it is taken only if valid.
      profile = await prisma.profile.create({ data: { id: user.id, username: acceptableUsername(user.metadataUsername) } })
    } catch (error) {
      // Lost a race with a parallel first request: the row exists now.
      if (prismaCode(error) !== UNIQUE_VIOLATION) throw error
      profile = await prisma.profile.findUnique({ where: { id: user.id } })
    }
  }
  if (!profile) throw problem(500, 'internal_error')
  event.context.profile = profile
  return profile
}

export function isBanned(profile: Pick<Profile, 'bannedUntil'>, now = new Date()): boolean {
  return profile.bannedUntil !== null && profile.bannedUntil > now
}

/** For anything that writes to the forum: the caller must not be banned. */
export async function requireActiveMember(event: H3Event): Promise<Profile> {
  const profile = await useProfile(event)
  if (isBanned(profile)) {
    throw problem(403, 'banned', 'Your forum access is suspended.', { bannedUntil: profile.bannedUntil!.toISOString() })
  }
  return profile
}

const rank: Record<UserRole, number> = { user: 0, moderator: 1, admin: 2 }

/** Roles live in the database, not in the JWT, so granting or revoking them takes effect immediately. */
export async function requireRole(event: H3Event, role: Exclude<UserRole, 'user'>): Promise<Profile> {
  const profile = await useProfile(event)
  if (rank[profile.role] < rank[role]) throw forbidden()
  // A suspended moderator or admin loses their powers too, not just their posting rights.
  if (isBanned(profile)) throw problem(403, 'banned', 'Your account is suspended.', { bannedUntil: profile.bannedUntil!.toISOString() })
  return profile
}

export function hasRole(profile: Pick<Profile, 'role'>, role: UserRole): boolean {
  return rank[profile.role] >= rank[role]
}
