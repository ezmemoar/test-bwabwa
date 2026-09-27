import type { Post, Prisma, Profile } from '~~/server/generated/prisma/client'
import type { Tx } from './prisma'

/** A post the viewer may see: not removed, and not hidden unless they wrote it or moderate. */
export async function findReadablePost(id: string, viewer: Profile): Promise<Post | null> {
  const post = await usePrisma().post.findFirst({ where: { id, removedAt: null } })
  if (!post) return null
  if (post.hiddenAt && post.authorId !== viewer.id && !hasRole(viewer, 'moderator')) return null
  return post
}

// `posts.comment_count` counts comments that are neither removed nor hidden. It changes only on actual state
// transitions (guarded updateMany: `count` says whether this call made the change), so retries and
// concurrent moderation never double-count.

async function bumpCommentCount(tx: Tx, postId: string, delta: 1 | -1) {
  if (delta === 1) await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } })
  else await tx.post.updateMany({ where: { id: postId, commentCount: { gt: 0 } }, data: { commentCount: { decrement: 1 } } })
}

/** Inserts unless the id exists already (an idempotent retry). Returns the new row, or undefined. */
export async function insertComment(tx: Tx, data: Prisma.CommentCreateManyInput) {
  const [row] = await tx.comment.createManyAndReturn({ data: [data], skipDuplicates: true, select: commentSelect })
  if (row) await bumpCommentCount(tx, row.postId, 1)
  return row
}

export type Target = { type: 'post' | 'comment'; id: string }

/** Soft-deletes a post or comment. Returns false if it was already gone. */
export async function removeTarget(tx: Tx, target: Target): Promise<boolean> {
  const now = new Date()
  if (target.type === 'post') {
    const { count } = await tx.post.updateMany({ where: { id: target.id, removedAt: null }, data: { removedAt: now } })
    return count > 0
  }
  const comment = await tx.comment.findUnique({ where: { id: target.id }, select: { postId: true, hiddenAt: true, removedAt: true } })
  if (!comment || comment.removedAt) return false
  const { count } = await tx.comment.updateMany({
    // Guard on the state we read, so the count adjustment below matches what actually changed.
    where: { id: target.id, removedAt: null, hiddenAt: comment.hiddenAt === null ? null : { not: null } },
    data: { removedAt: now },
  })
  if (count === 0) return false
  if (!comment.hiddenAt) await bumpCommentCount(tx, comment.postId, -1)
  return true
}

/** Hides a post or comment from everyone but its author and moderators. */
export async function hideTarget(tx: Tx, target: Target): Promise<boolean> {
  const now = new Date()
  const where = { id: target.id, hiddenAt: null, removedAt: null }
  if (target.type === 'post') {
    const { count } = await tx.post.updateMany({ where, data: { hiddenAt: now } })
    return count > 0
  }
  const { count } = await tx.comment.updateMany({ where, data: { hiddenAt: now } })
  if (count === 0) return false
  const { postId } = await tx.comment.findUniqueOrThrow({ where: { id: target.id }, select: { postId: true } })
  await bumpCommentCount(tx, postId, -1)
  return true
}

/** Undoes a hide (a moderator decided the reports were wrong) and clears the report counter. */
export async function restoreTarget(tx: Tx, target: Target): Promise<boolean> {
  const where = { id: target.id, hiddenAt: { not: null }, removedAt: null }
  const data = { hiddenAt: null, reportCount: 0 }
  if (target.type === 'post') {
    const { count } = await tx.post.updateMany({ where, data })
    return count > 0
  }
  const { count } = await tx.comment.updateMany({ where, data })
  if (count === 0) return false
  const { postId } = await tx.comment.findUniqueOrThrow({ where: { id: target.id }, select: { postId: true } })
  await bumpCommentCount(tx, postId, 1)
  return true
}

/**
 * Counts a new report and hides the target once enough *established* accounts reported it. Anonymous
 * accounts cost nothing to create, so reports from accounts younger than `reportMinAccountAgeHours`, or from
 * banned ones, are kept for moderators but can't hide anything on their own: otherwise three throwaway
 * accounts could silence any post.
 */
export async function registerReport(tx: Tx, target: Target): Promise<void> {
  const data = { reportCount: { increment: 1 } }
  if (target.type === 'post') await tx.post.update({ where: { id: target.id }, data })
  else await tx.comment.update({ where: { id: target.id }, data })

  const { autoHideReportThreshold, reportMinAccountAgeHours } = useConfig()
  const now = new Date()
  const establishedBefore = new Date(now.getTime() - reportMinAccountAgeHours * 3_600_000)
  const counted = await tx.report.count({
    where: {
      targetType: target.type,
      targetId: target.id,
      status: 'open',
      reporter: {
        createdAt: { lte: establishedBefore },
        OR: [{ bannedUntil: null }, { bannedUntil: { lte: now } }],
      },
    },
  })
  if (counted >= autoHideReportThreshold) await hideTarget(tx, target)
}
