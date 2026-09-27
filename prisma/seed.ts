/**
 * Development seed: `pnpm db:seed` (or `prisma migrate reset`, which runs it afterwards).
 *
 * Fills every table: auth users + profiles (regular, anonymous, banned, moderator, admin), forum posts and
 * comments, a spam post hidden by reports, a dismissed report, a user block, and journey backups (check-ins,
 * relapses, habit completions). Idempotent: ids are derived from names, so running it again converges on the
 * same data instead of duplicating it.
 *
 * Auth users: with NUXT_SUPABASE_SECRET_KEY set they're created through the Supabase Admin API (the proper
 * way on a real project); otherwise, or with SEED_AUTH=direct, rows go straight into auth.users, which is
 * what a local stub or the test database has.
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../server/generated/prisma/client'
import { databaseConnection, supabaseUrlFromDatabaseUrl } from '../server/utils/database-connection'
import {
  commentId,
  DISMISSED_REPORT,
  HABIT_IDS,
  postId,
  SEED_BLOCKS,
  SEED_JOURNEYS,
  SEED_POSTS,
  SEED_USERS,
  seedEmail,
  seedId,
  SETBACK_EMOTIONS,
  SPAM_POST,
  SPAM_REPORTERS,
  VICTORY_EMOTIONS,
  type SeedJourney,
} from './seed/data'

const DAY = 86_400_000

function refuseInProduction() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('Refusing to seed with NODE_ENV=production. Pass --force if you really mean it.')
    process.exit(1)
  }
}

/** Small deterministic hash so generated journeys look varied but are identical on every run. */
function pick(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

// ---------------------------------------------------------------------------------------------------------
// Auth users

async function ensureAuthUsersViaApi(supabaseUrl: string, secretKey: string): Promise<Map<string, string>> {
  const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' }
  const ids = new Map<string, string>()
  let existing: Map<string, string> | undefined

  for (const user of SEED_USERS) {
    const email = seedEmail(user.handle)
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: seedId(`user:${user.handle}`), email, email_confirm: true, user_metadata: { seed: true, handle: user.handle } }),
    })
    if (res.ok) {
      ids.set(user.handle, ((await res.json()) as { id: string }).id)
      continue
    }
    const error = (await res.json().catch(() => ({}))) as { error_code?: string; msg?: string }
    if (res.status !== 422 || error.error_code !== 'email_exists') {
      throw new Error(`Creating auth user ${email} failed: HTTP ${res.status} ${error.msg ?? ''}`)
    }
    // Already there from an earlier run: look its id up.
    existing ??= await listAuthUsers(supabaseUrl, headers)
    const id = existing.get(email)
    if (!id) throw new Error(`Auth user ${email} exists but could not be found`)
    ids.set(user.handle, id)
  }
  return ids
}

async function listAuthUsers(supabaseUrl: string, headers: Record<string, string>): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>()
  for (let page = 1; ; page++) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers })
    if (!res.ok) throw new Error(`Listing auth users failed: HTTP ${res.status}`)
    const { users } = (await res.json()) as { users: { id: string; email?: string }[] }
    for (const u of users) if (u.email) byEmail.set(u.email, u.id)
    if (users.length < 1000) return byEmail
  }
}

async function ensureAuthUsersDirect(prisma: PrismaClient): Promise<Map<string, string>> {
  const ids = new Map(SEED_USERS.map((u) => [u.handle, seedId(`user:${u.handle}`)]))
  // auth.users is Supabase's table and not part of the Prisma schema: raw SQL, local databases only.
  for (const [handle, id] of ids) {
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${seedEmail(handle)}) ON CONFLICT (id) DO NOTHING`
  }
  return ids
}

// ---------------------------------------------------------------------------------------------------------
// Journeys

function buildJourney(journey: SeedJourney, userId: string, now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dayAt = (daysAgo: number, hour = 0, minute = 0) => new Date(today - daysAgo * DAY + (hour * 60 + minute) * 60_000)
  const relapseDays = new Set(journey.relapsesDaysAgo)

  const checkIns = []
  for (let d = journey.length - 1; d >= 1; d--) {
    // Like real people, not every day gets a check-in.
    if (!relapseDays.has(d) && pick(journey.handle, d, 'skip') % 9 === 0) continue
    const setback = relapseDays.has(d)
    const pool = setback ? SETBACK_EMOTIONS : VICTORY_EMOTIONS
    const first = pick(journey.handle, d, 'e1') % pool.length
    const second = (first + 1 + (pick(journey.handle, d, 'e2') % (pool.length - 1))) % pool.length
    const detailed = pick(journey.handle, d, 'detail') % 3 === 0
    checkIns.push({
      userId,
      day: dayAt(d),
      outcome: setback ? ('setback' as const) : ('victory' as const),
      emotions: [pool[first]!, pool[second]!],
      urge: setback ? 7 + (pick(journey.handle, d, 'u') % 4) : pick(journey.handle, d, 'u') % 5,
      reflectionToday: detailed ? (setback ? 'Stayed up late scrolling after a long day.' : 'Went for a walk when the urge hit.') : null,
      reflectionTomorrow: detailed ? 'Phone charges in the kitchen tonight.' : null,
      journal: detailed && !setback ? 'Quieter head today. Proud of the small wins.' : null,
      recommitQuote: setback ? 'I climb, I rest, I keep climbing.' : null,
      recordedAt: setback ? dayAt(d, 23, 59) : dayAt(d, 21),
    })
  }

  const relapses = journey.relapsesDaysAgo.map((d, i) => ({
    userId,
    occurredAt: dayAt(d, 23, 59),
    note: i === 0 ? 'Late night, alone, tired. Noted the pattern.' : null,
  }))

  const habitCompletions = []
  for (let d = Math.min(journey.length, 30) - 1; d >= 0; d--) {
    for (const habitId of HABIT_IDS) {
      if (pick(journey.handle, d, habitId) % 3 !== 0) habitCompletions.push({ userId, habitId, day: dayAt(d) })
    }
  }

  return { startedAt: dayAt(journey.length), checkIns, relapses, habitCompletions }
}

// ---------------------------------------------------------------------------------------------------------

async function main() {
  refuseInProduction()
  const url = process.env.MIGRATION_DATABASE_URL || process.env.NUXT_SUPABASE_DIRECT_URL || process.env.NUXT_SUPABASE_DATABASE_URL
  if (!url) throw new Error('Set NUXT_SUPABASE_DIRECT_URL (or MIGRATION_DATABASE_URL) to seed.')
  const connection = databaseConnection(url, process.env.NUXT_SUPABASE_DATABASE_CA ?? '')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.connectionString, ssl: connection.ssl, max: 1 }) })

  try {
    const supabaseUrl = (process.env.NUXT_SUPABASE_URL || supabaseUrlFromDatabaseUrl(url) || '').replace(/\/+$/, '')
    const secretKey = process.env.NUXT_SUPABASE_SECRET_KEY
    const viaApi = Boolean(supabaseUrl && secretKey) && process.env.SEED_AUTH !== 'direct'
    const ids = viaApi ? await ensureAuthUsersViaApi(supabaseUrl!, secretKey!) : await ensureAuthUsersDirect(prisma)
    const userId = (handle: string) => ids.get(handle) ?? (() => { throw new Error(`unknown seed user ${handle}`) })()
    const user = (handle: string) => SEED_USERS.find((u) => u.handle === handle)!
    const now = new Date()
    const mod = userId('climbly_mod')

    await prisma.$transaction(
      async (tx) => {
        for (const u of SEED_USERS) {
          const state = {
            username: u.username,
            role: u.role,
            bannedUntil: u.banned ? new Date('9999-12-31T00:00:00Z') : null,
            banReason: u.banned?.reason ?? null,
          }
          await tx.profile.upsert({
            where: { id: userId(u.handle) },
            // Long-standing members: their reports count toward auto-hiding (see registerReport).
            create: { id: userId(u.handle), ...state, createdAt: new Date(now.getTime() - 120 * DAY) },
            update: state,
          })
        }

        for (const p of [...SEED_POSTS, SPAM_POST]) {
          const author = user(p.author)
          const spam = p === SPAM_POST
          await tx.post.upsert({
            where: { id: postId(p.key) },
            create: {
              id: postId(p.key),
              authorId: userId(p.author),
              authorName: author.username ?? 'anonymous',
              authorStreakDays: author.streakDays,
              body: p.body,
              commentCount: p.comments.length,
              reportCount: spam ? SPAM_REPORTERS.length : 0,
              hiddenAt: spam ? new Date(now.getTime() - p.ago / 2) : null,
              createdAt: new Date(now.getTime() - p.ago),
            },
            update: {},
          })
          for (const c of p.comments) {
            await tx.comment.upsert({
              where: { id: commentId(p.key, c.key) },
              create: {
                id: commentId(p.key, c.key),
                postId: postId(p.key),
                authorId: userId(c.author),
                authorName: user(c.author).username ?? 'anonymous',
                body: c.body,
                createdAt: new Date(now.getTime() - c.ago),
              },
              update: {},
            })
          }
        }

        await tx.report.createMany({
          data: SPAM_REPORTERS.map((r) => ({ reporterId: userId(r), targetType: 'post' as const, targetId: postId(SPAM_POST.key), reason: 'spam' as const })),
          skipDuplicates: true,
        })
        await tx.report.createMany({
          data: [
            {
              reporterId: userId(DISMISSED_REPORT.reporter),
              targetType: 'post',
              targetId: postId(DISMISSED_REPORT.post),
              reason: DISMISSED_REPORT.reason,
              details: 'Not sure this is okay?',
              status: 'dismissed',
              resolvedBy: mod,
              resolvedAt: now,
            },
          ],
          skipDuplicates: true,
        })

        await tx.userBlock.createMany({
          data: SEED_BLOCKS.map(([blocker, blocked]) => ({ blockerId: userId(blocker), blockedId: userId(blocked) })),
          skipDuplicates: true,
        })

        // Journeys are whole snapshots, exactly like the app's backup: replace, don't merge.
        for (const j of SEED_JOURNEYS) {
          const id = userId(j.handle)
          const journey = buildJourney(j, id, now)
          await tx.checkIn.deleteMany({ where: { userId: id } })
          await tx.relapse.deleteMany({ where: { userId: id } })
          await tx.habitCompletion.deleteMany({ where: { userId: id } })
          await tx.checkIn.createMany({ data: journey.checkIns })
          await tx.relapse.createMany({ data: journey.relapses })
          await tx.habitCompletion.createMany({ data: journey.habitCompletions })
          await tx.profile.update({ where: { id }, data: { journeyStartedAt: journey.startedAt, journeySnapshotAt: now } })
        }
      },
      { maxWait: 10_000, timeout: 60_000 },
    )

    const counts = {
      users: await prisma.profile.count(),
      posts: await prisma.post.count(),
      comments: await prisma.comment.count(),
      reports: await prisma.report.count(),
      blocks: await prisma.userBlock.count(),
      checkIns: await prisma.checkIn.count(),
      relapses: await prisma.relapse.count(),
      habitCompletions: await prisma.habitCompletion.count(),
    }
    console.log(`Seeded (auth users via ${viaApi ? 'Supabase Admin API' : 'direct insert'}):`, counts)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
