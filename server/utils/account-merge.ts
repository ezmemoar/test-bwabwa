// Every install starts on an anonymous Supabase account, and that account owns forum posts, comments, reports,
// blocks and the journey backup. When the person registers or signs in with email and password while still
// presenting that anonymous token, everything moves to the real account. Both identities are proven in the
// same request (the anonymous token and the password), which is what makes the transfer safe. This is the
// server-side version of the flow Supabase documents for linking an anonymous user to an existing account.

export interface MergeResult {
  merged: boolean
}

export async function adoptAnonymousAccount(anonymousId: string, targetId: string): Promise<MergeResult> {
  if (anonymousId === targetId) return { merged: false }
  const prisma = usePrisma()

  const merged = await prisma.$transaction(
    async (tx) => {
      const anon = await tx.profile.findUnique({ where: { id: anonymousId } })
      if (!anon) return false
      const target = await tx.profile.upsert({ where: { id: targetId }, create: { id: targetId }, update: {} })

      // Forum content keeps its author-name snapshot; only ownership moves.
      await tx.post.updateMany({ where: { authorId: anonymousId }, data: { authorId: targetId } })
      await tx.comment.updateMany({ where: { authorId: anonymousId }, data: { authorId: targetId } })

      // A report both accounts filed on the same thing would break the one-report-per-person rule: keep one.
      await tx.$executeRaw`
        DELETE FROM public.reports a USING public.reports t
        WHERE a.reporter_id = ${anonymousId}::uuid AND t.reporter_id = ${targetId}::uuid
          AND a.target_type = t.target_type AND a.target_id = t.target_id`
      await tx.report.updateMany({ where: { reporterId: anonymousId }, data: { reporterId: targetId } })

      // Blocks in both directions, minus any block between the two accounts themselves.
      await tx.$executeRaw`
        INSERT INTO public.user_blocks (blocker_id, blocked_id, created_at)
        SELECT ${targetId}::uuid, blocked_id, created_at FROM public.user_blocks
        WHERE blocker_id = ${anonymousId}::uuid AND blocked_id <> ${targetId}::uuid
        ON CONFLICT DO NOTHING`
      await tx.$executeRaw`
        INSERT INTO public.user_blocks (blocker_id, blocked_id, created_at)
        SELECT blocker_id, ${targetId}::uuid, created_at FROM public.user_blocks
        WHERE blocked_id = ${anonymousId}::uuid AND blocker_id <> ${targetId}::uuid
        ON CONFLICT DO NOTHING`

      // The journey backup moves only if the account has none of its own (the app re-uploads anyway).
      const moveJourney = target.journeySnapshotAt === null && anon.journeySnapshotAt !== null
      if (moveJourney) {
        await tx.checkIn.updateMany({ where: { userId: anonymousId }, data: { userId: targetId } })
        await tx.relapse.updateMany({ where: { userId: anonymousId }, data: { userId: targetId } })
        await tx.habitCompletion.updateMany({ where: { userId: anonymousId }, data: { userId: targetId } })
      }

      // A suspension follows the person: registering must not be a way out of a ban.
      const bannedUntil =
        anon.bannedUntil && (!target.bannedUntil || anon.bannedUntil > target.bannedUntil) ? anon.bannedUntil : target.bannedUntil

      await tx.profile.update({
        where: { id: targetId },
        data: {
          username: target.username ?? anon.username,
          bannedUntil,
          banReason: bannedUntil === anon.bannedUntil && anon.bannedUntil ? anon.banReason : target.banReason,
          ...(moveJourney && { journeyStartedAt: anon.journeyStartedAt, journeySnapshotAt: anon.journeySnapshotAt }),
        },
      })
      // Whatever didn't move (the anonymous profile, blocks between the two, a superseded journey) goes.
      await tx.profile.delete({ where: { id: anonymousId } })
      return true
    },
    { maxWait: 5_000, timeout: 20_000 },
  )

  if (merged) {
    log.info('anonymous account merged', { from: anonymousId, into: targetId })
    await deleteAuthUser(anonymousId).catch((error) => log.warn('could not delete merged anonymous auth user', { userId: anonymousId, ...serializeError(error) }))
  }
  return { merged }
}

/** Removes a Supabase auth user through the Admin API. A no-op without the secret key. */
export async function deleteAuthUser(userId: string): Promise<void> {
  const { url, secretKey } = useConfig().supabase
  if (!secretKey) return
  try {
    await $fetch(`/auth/v1/admin/users/${userId}`, {
      baseURL: url,
      method: 'DELETE',
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
      timeout: 10_000,
      retry: 1,
    })
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error
  }
}
