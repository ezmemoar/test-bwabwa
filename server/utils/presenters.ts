import type { Comment, Post, Profile } from '~~/server/generated/prisma/client'
import type { AuthUser } from './auth'

// The only shapes that leave the server. Internal columns (report counts, moderation stamps) are never
// serialised by accident because handlers return these, not rows.

export type PostRow = Pick<Post, 'id' | 'authorId' | 'authorName' | 'authorStreakDays' | 'body' | 'commentCount' | 'hiddenAt' | 'createdAt'>
export type CommentRow = Pick<Comment, 'id' | 'postId' | 'authorId' | 'authorName' | 'body' | 'hiddenAt' | 'createdAt'>

/** Prisma `select` for [PostRow]: fetch only what is presented. */
export const postSelect = {
  id: true,
  authorId: true,
  authorName: true,
  authorStreakDays: true,
  body: true,
  commentCount: true,
  hiddenAt: true,
  createdAt: true,
} as const

export const commentSelect = {
  id: true,
  postId: true,
  authorId: true,
  authorName: true,
  body: true,
  hiddenAt: true,
  createdAt: true,
} as const

export function presentPost(post: PostRow, viewerId: string) {
  return {
    id: post.id,
    author: { id: post.authorId, name: post.authorName, streakDays: post.authorStreakDays },
    body: post.body,
    commentCount: post.commentCount,
    isMine: post.authorId === viewerId,
    /** Only ever true for the author (or a moderator): hidden posts are not served to anyone else. */
    isHidden: post.hiddenAt !== null,
    createdAt: post.createdAt.toISOString(),
  }
}

export function presentComment(comment: CommentRow, viewerId: string) {
  return {
    id: comment.id,
    postId: comment.postId,
    author: { id: comment.authorId, name: comment.authorName },
    body: comment.body,
    isMine: comment.authorId === viewerId,
    isHidden: comment.hiddenAt !== null,
    createdAt: comment.createdAt.toISOString(),
  }
}

export function presentMe(profile: Profile, user: AuthUser) {
  return {
    id: profile.id,
    username: profile.username,
    /** Deprecated alias of `username`, kept for app versions that still read it. */
    displayName: profile.username,
    email: user.email,
    role: profile.role,
    isAnonymous: user.isAnonymous,
    bannedUntil: isBanned(profile) ? profile.bannedUntil!.toISOString() : null,
    createdAt: profile.createdAt.toISOString(),
  }
}

export const ANONYMOUS_NAME = 'anonymous'
