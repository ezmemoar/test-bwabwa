import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { postId, SEED_POSTS, seedId, SPAM_POST } from '../prisma/seed/data'
import { GOOGLE_SIGNATURE, GOOGLE_WEB_CLIENT_ID } from './fake-supabase-auth'
import { api, token, USERS, uuid } from './helpers'

const postBody = (n: number | string) => `Day ${n}: holding the rope today, one foothold at a time.`

describe('platform', () => {
  it('reports liveness and readiness', async () => {
    expect((await api('GET', '/api/health')).body).toEqual({ status: 'ok' })
    const ready = await api('GET', '/api/health/ready')
    expect(ready.status).toBe(200)
    expect(ready.body.db.latencyMs).toBeTypeOf('number')
  })

  it('answers unknown endpoints with problem+json and security headers', async () => {
    const res = await api('GET', '/api/v1/nope', { as: 'alice' })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect(res.body).toMatchObject({ status: 404, code: 'not_found' })
    expect(res.body.requestId).toBe(res.headers.get('x-request-id'))
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('echoes a well-formed inbound request id', async () => {
    const res = await api('GET', '/api/health', { headers: { 'x-request-id': 'trace-abc-12345' } })
    expect(res.headers.get('x-request-id')).toBe('trace-abc-12345')
  })

  it('publishes an OpenAPI document', async () => {
    const res = await api('GET', '/api/openapi.json')
    // Only generated in dev unless explicitly enabled for production.
    expect([200, 404]).toContain(res.status)
  })
})

describe('authentication', () => {
  it('requires a token', async () => {
    const res = await api('GET', '/api/v1/me')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('unauthorized')
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })

  it('rejects malformed, forged, expired and foreign tokens', async () => {
    const cases = [
      { headers: { authorization: 'Basic abc' } },
      { token: await token('alice', { unknownKey: true }) },
      { token: await token('alice', { hs256: 'another-secret-another-secret-another' }) },
      { token: await token('alice', { exp: Math.floor(Date.now() / 1000) - 60 }) },
      { token: await token('alice', { aud: 'something-else' }) },
      { token: await token('alice', { iss: 'https://evil.example/auth/v1' }) },
      { token: await token('alice', { role: 'anon' }) },
    ]
    for (const c of cases) {
      const res = await api('GET', '/api/v1/me', c)
      expect(res.status, JSON.stringify(c)).toBe(401)
      expect(res.body.code).toBe('invalid_token')
    }
  })

  it('accepts JWKS-signed (ES256) and legacy HS256 tokens', async () => {
    expect((await api('GET', '/api/v1/me', { token: await token('alice') })).status).toBe(200)
    expect((await api('GET', '/api/v1/me', { token: await token('alice', { hs256: true }) })).status).toBe(200)
  })

  it('treats a token for a deleted auth user as invalid', async () => {
    const res = await api('GET', '/api/v1/me', { as: 'ghost' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('invalid_token')
  })
})

describe('profile', () => {
  it('creates the profile on first use and updates the display name', async () => {
    const me = await api('GET', '/api/v1/me', { as: 'alice' })
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ id: USERS.alice, displayName: null, role: 'user', isAnonymous: true, bannedUntil: null })

    const patched = await api('PATCH', '/api/v1/me', { as: 'alice', body: { displayName: '  Summit Seeker  ' } })
    expect(patched.status).toBe(200)
    expect(patched.body.displayName).toBe('Summit Seeker')

    const cleared = await api('PATCH', '/api/v1/me', { as: 'erin', body: { displayName: '' } })
    expect(cleared.body.displayName).toBeNull()
  })

  it('validates display names', async () => {
    const short = await api('PATCH', '/api/v1/me', { as: 'alice', body: { displayName: 'x' } })
    expect(short.status).toBe(422)
    expect(short.body.code).toBe('validation_failed')
    expect(short.body.errors[0].path).toBe('displayName')

    const link = await api('PATCH', '/api/v1/me', { as: 'alice', body: { displayName: 'visit spam.com' } })
    expect(link.status).toBe(422)
    expect(link.body.code).toBe('links_not_allowed')
  })

  it('enforces JSON bodies, sizes and valid JSON', async () => {
    const wrongType = await api('PATCH', '/api/v1/me', { as: 'alice', rawBody: 'displayName=x', headers: { 'content-type': 'text/plain' } })
    expect(wrongType.status).toBe(415)

    const huge = await api('PATCH', '/api/v1/me', { as: 'alice', body: { displayName: 'x'.repeat(70_000) } })
    expect(huge.status).toBe(413)

    const broken = await api('PATCH', '/api/v1/me', { as: 'alice', rawBody: '{"displayName":', headers: { 'content-type': 'application/json' } })
    expect(broken.status).toBe(400)
    expect(broken.body.code).toBe('invalid_json')
  })
})

describe('forum', () => {
  it('creates posts idempotently and never lets another user claim an id', async () => {
    const id = uuid()
    const first = await api('POST', '/api/v1/posts', { as: 'alice', body: { id, body: postBody(1), streakDays: 12 } })
    expect(first.status).toBe(201)
    expect(first.headers.get('location')).toBe(`/api/v1/posts/${id}`)
    expect(first.body).toMatchObject({ id, body: postBody(1), commentCount: 0, isMine: true, author: { id: USERS.alice, name: 'Summit Seeker', streakDays: 12 } })

    const replay = await api('POST', '/api/v1/posts', { as: 'alice', body: { id, body: postBody(1), streakDays: 12 } })
    expect(replay.status).toBe(200)
    expect(replay.body.id).toBe(id)

    const hijack = await api('POST', '/api/v1/posts', { as: 'bob', body: { id, body: postBody(2) } })
    expect(hijack.status).toBe(409)

    const seenByBob = await api('GET', `/api/v1/posts/${id}`, { as: 'bob' })
    expect(seenByBob.body).toMatchObject({ isMine: false, author: { name: 'Summit Seeker' } })
  })

  it('rejects short posts and links', async () => {
    const short = await api('POST', '/api/v1/posts', { as: 'bob', body: { body: 'too short' } })
    expect(short.status).toBe(422)
    const link = await api('POST', '/api/v1/posts', { as: 'bob', body: { body: 'check out https://example.com for help' } })
    expect(link.body.code).toBe('links_not_allowed')
  })

  it('pages through the feed newest first without gaps or repeats', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const res = await api('POST', '/api/v1/posts', { as: 'dave', body: { body: postBody(`dave-${i}`) } })
      expect(res.status).toBe(201)
      ids.push(res.body.id)
    }
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const res: any = await api('GET', `/api/v1/posts?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { as: 'dave' })
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeLessThanOrEqual(2)
      seen.push(...res.body.data.map((p: { id: string }) => p.id))
      cursor = res.body.nextCursor
    } while (cursor)
    expect(new Set(seen).size).toBe(seen.length)
    // Dave's four posts are the newest, in reverse creation order.
    expect(seen.slice(0, 4)).toEqual([...ids].reverse())

    const bad = await api('GET', '/api/v1/posts?cursor=not-a-cursor', { as: 'dave' })
    expect(bad.status).toBe(400)
  })

  it('keeps comment counts right through create and delete, and guards deletion', async () => {
    const post = await api('POST', '/api/v1/posts', { as: 'bob', body: { body: postBody('bob') } })
    const postId = post.body.id
    const c1 = await api('POST', `/api/v1/posts/${postId}/comments`, { as: 'alice', body: { body: 'Proud of you.' } })
    const c2 = await api('POST', `/api/v1/posts/${postId}/comments`, { as: 'dave', body: { body: 'Keep climbing.' } })
    expect(c1.status).toBe(201)
    expect(c2.status).toBe(201)

    expect((await api('GET', `/api/v1/posts/${postId}`, { as: 'bob' })).body.commentCount).toBe(2)
    const thread = await api('GET', `/api/v1/posts/${postId}/comments`, { as: 'bob' })
    expect(thread.body.data.map((c: { body: string }) => c.body)).toEqual(['Proud of you.', 'Keep climbing.'])

    expect((await api('DELETE', `/api/v1/comments/${c1.body.id}`, { as: 'bob' })).status).toBe(403)
    expect((await api('DELETE', `/api/v1/comments/${c1.body.id}`, { as: 'alice' })).status).toBe(204)
    expect((await api('DELETE', `/api/v1/comments/${c1.body.id}`, { as: 'alice' })).status).toBe(404)
    expect((await api('GET', `/api/v1/posts/${postId}`, { as: 'bob' })).body.commentCount).toBe(1)

    expect((await api('DELETE', `/api/v1/posts/${postId}`, { as: 'alice' })).status).toBe(403)
    expect((await api('DELETE', `/api/v1/posts/${postId}`, { as: 'mod' })).status).toBe(204)
    expect((await api('GET', `/api/v1/posts/${postId}`, { as: 'bob' })).status).toBe(404)
  })

  it('hides content after enough distinct reports and lets a moderator restore it', async () => {
    const post = await api('POST', '/api/v1/posts', { as: 'frank', body: { body: postBody('frank') } })
    const postId = post.body.id
    const report = { targetType: 'post', targetId: postId, reason: 'spam' }

    // Self-reports and duplicate reports don't count.
    expect((await api('POST', '/api/v1/reports', { as: 'frank', body: report })).status).toBe(202)
    for (const who of ['alice', 'alice', 'bob'] as const) {
      expect((await api('POST', '/api/v1/reports', { as: who, body: report })).status).toBe(202)
    }
    expect((await api('GET', `/api/v1/posts/${postId}`, { as: 'dave' })).status).toBe(200)

    await api('POST', '/api/v1/reports', { as: 'dave', body: report })
    expect((await api('GET', `/api/v1/posts/${postId}`, { as: 'dave' })).status).toBe(404)
    const own = await api('GET', `/api/v1/posts/${postId}`, { as: 'frank' })
    expect(own.body.isHidden).toBe(true)

    expect((await api('GET', '/api/v1/moderation/reports', { as: 'alice' })).status).toBe(403)
    const queue = await api('GET', '/api/v1/moderation/reports', { as: 'mod' })
    const mine = queue.body.data.filter((r: { target: { id: string } }) => r.target.id === postId)
    expect(mine).toHaveLength(3)
    expect(mine[0].target).toMatchObject({ type: 'post', authorId: USERS.frank, reportCount: 3 })

    const resolved = await api('POST', `/api/v1/moderation/reports/${mine[0].id}/resolve`, { as: 'mod', body: { action: 'restore' } })
    expect(resolved.body).toEqual({ action: 'restore', closedReports: 3 })
    expect((await api('GET', `/api/v1/posts/${postId}`, { as: 'dave' })).status).toBe(200)
  })

  it("hides a blocked person's posts from the blocker only", async () => {
    const post = await api('POST', '/api/v1/posts', { as: 'erin', body: { body: postBody('erin') } })
    expect((await api('PUT', `/api/v1/blocks/${USERS.erin}`, { as: 'carol' })).status).toBe(204)
    expect((await api('PUT', `/api/v1/blocks/${USERS.carol}`, { as: 'carol' })).status).toBe(422)

    const carolFeed = await api('GET', '/api/v1/posts?limit=50', { as: 'carol' })
    expect(carolFeed.body.data.some((p: { id: string }) => p.id === post.body.id)).toBe(false)
    const daveFeed = await api('GET', '/api/v1/posts?limit=50', { as: 'dave' })
    expect(daveFeed.body.data.some((p: { id: string }) => p.id === post.body.id)).toBe(true)

    expect((await api('GET', '/api/v1/blocks', { as: 'carol' })).body.data).toEqual([expect.objectContaining({ userId: USERS.erin })])
    expect((await api('DELETE', `/api/v1/blocks/${USERS.erin}`, { as: 'carol' })).status).toBe(204)
  })

  it('stops banned users from writing, and only admins manage roles', async () => {
    const ban = await api('PUT', `/api/v1/moderation/users/${USERS.carol}/ban`, { as: 'mod', body: { reason: 'spam' } })
    expect(ban.status).toBe(200)
    const blocked = await api('POST', '/api/v1/posts', { as: 'carol', body: { body: postBody('carol') } })
    expect(blocked.status).toBe(403)
    expect(blocked.body.code).toBe('banned')
    expect((await api('GET', '/api/v1/me', { as: 'carol' })).body.bannedUntil).not.toBeNull()

    expect((await api('PUT', `/api/v1/moderation/users/${USERS.admin}/ban`, { as: 'mod', body: {} })).status).toBe(403)
    expect((await api('DELETE', `/api/v1/moderation/users/${USERS.carol}/ban`, { as: 'mod' })).status).toBe(204)
    expect((await api('POST', '/api/v1/posts', { as: 'carol', body: { body: postBody('carol') } })).status).toBe(201)

    expect((await api('PUT', `/api/v1/admin/users/${USERS.bob}/role`, { as: 'mod', body: { role: 'moderator' } })).status).toBe(403)
    const promoted = await api('PUT', `/api/v1/admin/users/${USERS.bob}/role`, { as: 'admin', body: { role: 'moderator' } })
    expect(promoted.body).toEqual({ userId: USERS.bob, role: 'moderator' })
    expect((await api('GET', '/api/v1/moderation/reports', { as: 'bob' })).status).toBe(200)
    await api('PUT', `/api/v1/admin/users/${USERS.bob}/role`, { as: 'admin', body: { role: 'user' } })
    expect((await api('GET', '/api/v1/moderation/reports', { as: 'bob' })).status).toBe(403)
  })
})

describe('rate limiting', () => {
  it('limits post creation per user and says when to retry', async () => {
    // erin has one post already; the policy allows five per 15 minutes.
    const statuses: number[] = []
    let last
    for (let i = 0; i < 5; i++) {
      last = await api('POST', '/api/v1/posts', { as: 'erin', body: { body: postBody(`erin-${i}`) } })
      statuses.push(last.status)
    }
    expect(statuses).toEqual([201, 201, 201, 201, 429])
    expect(last!.body.code).toBe('rate_limited')
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(last!.headers.get('ratelimit-limit')).toBe('5')
    expect(last!.headers.get('ratelimit-remaining')).toBe('0')

    // Other people are unaffected.
    expect((await api('POST', '/api/v1/posts', { as: 'frank', body: { body: postBody('frank-2') } })).status).toBe(201)
  })
})

describe('journey backup', () => {
  const snapshot = (at: string) => ({
    snapshotAt: at,
    startedAt: '2026-09-01T00:00:00.000+07:00',
    checkIns: [
      { day: '2026-09-20', outcome: 'victory', emotions: ['calm', 'hopeful'], urge: 3, journal: 'Good day.', recordedAt: '2026-09-20T21:00:00Z' },
      { day: '2026-09-21', outcome: 'setback', recordedAt: '2026-09-21T23:59:00Z' },
    ],
    relapses: [{ occurredAt: '2026-09-21T23:59:00Z', note: null }],
    habitCompletions: [
      { habitId: 'walk', day: '2026-09-20' },
      { habitId: 'read', day: '2026-09-20' },
    ],
  })

  it('stores, replaces and returns the whole snapshot', async () => {
    const put = await api('PUT', '/api/v1/journey', { as: 'bob', body: snapshot('2026-09-27T10:00:00Z') })
    expect(put.status).toBe(200)
    expect(put.body.counts).toEqual({ checkIns: 2, relapses: 1, habitCompletions: 2 })

    const smaller = { ...snapshot('2026-09-27T11:00:00Z'), habitCompletions: [] }
    expect((await api('PUT', '/api/v1/journey', { as: 'bob', body: smaller })).status).toBe(200)

    const got = await api('GET', '/api/v1/journey', { as: 'bob' })
    expect(got.body.snapshotAt).toBe('2026-09-27T11:00:00.000Z')
    expect(got.body.checkIns).toHaveLength(2)
    expect(got.body.checkIns[0]).toMatchObject({ day: '2026-09-20', outcome: 'victory', emotions: ['calm', 'hopeful'], urge: 3, journal: 'Good day.' })
    expect(got.body.checkIns[1]).toMatchObject({ day: '2026-09-21', emotions: [], urge: null, journal: null })
    expect(got.body.habitCompletions).toEqual([])

    // Nobody else sees it.
    expect((await api('GET', '/api/v1/journey', { as: 'dave' })).body.checkIns).toEqual([])
  })

  it('rejects stale snapshots and duplicate days', async () => {
    const stale = await api('PUT', '/api/v1/journey', { as: 'bob', body: snapshot('2026-09-27T09:00:00Z') })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('stale_snapshot')

    const dup = snapshot('2026-09-27T12:00:00Z')
    dup.checkIns.push({ ...dup.checkIns[0]! })
    const res = await api('PUT', '/api/v1/journey', { as: 'bob', body: dup })
    expect(res.status).toBe(422)
    expect(res.body.errors[0].path).toBe('checkIns.2.day')
  })
})

describe('security hardening', () => {
  it('keys rate limits by the proxy-appended address, not the client-supplied part of X-Forwarded-For', async () => {
    // One trusted proxy: only the rightmost entry is real. Forging the left part must not buy a fresh bucket.
    const hit = (forged: string) => api('GET', '/api/v1/unknown', { headers: { 'x-forwarded-for': `${forged}, 10.9.9.9` } })
    const first = Number((await hit('203.0.113.1')).headers.get('ratelimit-remaining'))
    const second = Number((await hit('203.0.113.2')).headers.get('ratelimit-remaining'))
    const third = Number((await hit('198.51.100.7')).headers.get('ratelimit-remaining'))
    expect([second, third]).toEqual([first - 1, first - 2])
  })

  it("doesn't let brand-new accounts hide content by reporting it", async () => {
    const post = await api('POST', '/api/v1/posts', { as: 'carol', body: { body: postBody('brigade target') } })
    const report = { targetType: 'post', targetId: post.body.id, reason: 'spam' }
    for (const who of ['newbie1', 'newbie2', 'newbie3']) {
      expect((await api('POST', '/api/v1/reports', { as: who, body: report })).status).toBe(202)
    }
    // Still visible to everyone...
    expect((await api('GET', `/api/v1/posts/${post.body.id}`, { as: 'alice' })).status).toBe(200)
    // ...and still in the moderators' queue.
    const queue = await api('GET', '/api/v1/moderation/reports', { as: 'mod' })
    expect(queue.body.data.filter((r: { target: { id: string } }) => r.target.id === post.body.id)).toHaveLength(3)
  })

  it('reserves staff-sounding display names for staff', async () => {
    for (const name of ['Climbly Support', 'admin', 'Cl1mbly', 'the.mods']) {
      const res = await api('PATCH', '/api/v1/me', { as: 'alice', body: { displayName: name } })
      expect(res.status, name).toBe(422)
      expect(res.body.errors[0]).toEqual({ path: 'displayName', message: 'is reserved' })
    }
    expect((await api('PATCH', '/api/v1/me', { as: 'alice', body: { displayName: 'badminton_fan' } })).status).toBe(200)
    expect((await api('PATCH', '/api/v1/me', { as: 'mod', body: { displayName: 'Climbly team' } })).status).toBe(200)
    await api('PATCH', '/api/v1/me', { as: 'alice', body: { displayName: 'Summit Seeker' } })
  })

  it('strips moderation powers from suspended staff, and only admins decide about moderators', async () => {
    await api('PUT', `/api/v1/admin/users/${USERS.carol}/role`, { as: 'admin', body: { role: 'moderator' } })
    expect((await api('PUT', `/api/v1/moderation/users/${USERS.carol}/ban`, { as: 'admin', body: {} })).status).toBe(200)

    const suspended = await api('GET', '/api/v1/moderation/reports', { as: 'carol' })
    expect(suspended.status).toBe(403)
    expect(suspended.body.code).toBe('banned')
    expect((await api('DELETE', `/api/v1/moderation/users/${USERS.carol}/ban`, { as: 'mod' })).status).toBe(403)

    expect((await api('DELETE', `/api/v1/moderation/users/${USERS.carol}/ban`, { as: 'admin' })).status).toBe(204)
    expect((await api('GET', '/api/v1/moderation/reports', { as: 'carol' })).status).toBe(200)
    await api('PUT', `/api/v1/admin/users/${USERS.carol}/role`, { as: 'admin', body: { role: 'user' } })
  })
})

describe('auth: register and login', () => {
  let n = 0
  /** A fresh client address per call keeps the per-IP auth limits out of the way unless a test wants them. */
  const ip = () => `172.16.${Math.floor(++n / 250)}.${n % 250}`
  const email = (tag: string) => `${tag}.${Date.now()}.${n}@example.com`

  it('registers with a username, and the session works on the rest of the API', async () => {
    const address = email('reg')
    const res = await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: address, password: 'correct horse 9', username: 'Trail Runner' } })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ confirmationRequired: false, mergedAnonymousAccount: false, user: { email: address, isAnonymous: false } })
    expect(res.body.session).toMatchObject({ tokenType: 'bearer', expiresIn: 3600 })

    const me = await api('GET', '/api/v1/me', { token: res.body.session.accessToken })
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ id: res.body.user.id, username: 'Trail Runner', displayName: 'Trail Runner', email: address, isAnonymous: false })

    const dup = await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: address.toUpperCase(), password: 'another pass 9' } })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('email_taken')
  })

  it('validates registrations before they reach Supabase', async () => {
    const short = await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: email('short'), password: 'short' } })
    expect(short.status).toBe(422)
    expect(short.body.errors[0].path).toBe('password')

    const bad = await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: 'not-an-email', password: 'long enough 9' } })
    expect(bad.body.errors[0].path).toBe('email')

    const reserved = await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: email('res'), password: 'long enough 9', username: 'Climbly Support' } })
    expect(reserved.status).toBe(422)

    const weak = await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: email('weak'), password: 'password123' } })
    expect(weak.status).toBe(422)
    expect(weak.body).toMatchObject({ code: 'weak_password', reasons: ['pwned'] })
  })

  it('handles projects that require email confirmation', async () => {
    const address = email('wait+confirm')
    const res = await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: address, password: 'long enough 9' } })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ confirmationRequired: true, session: null, user: { email: address, emailConfirmed: false } })

    const login = await api('POST', '/api/v1/auth/login', { ip: ip(), body: { email: address, password: 'long enough 9' } })
    expect(login.status).toBe(403)
    expect(login.body.code).toBe('email_not_confirmed')
  })

  it('creates anonymous accounts through the API and refreshes them', async () => {
    // A stale bearer from an earlier install doesn't get in the way either.
    const res = await api('POST', '/api/v1/auth/anonymous', { ip: ip(), token: 'a.b.c' })
    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ isAnonymous: true, email: null, emailConfirmed: false })
    const { accessToken, refreshToken, expiresAt } = res.body.session
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000)

    const me = await api('GET', '/api/v1/me', { ip: ip(), token: accessToken })
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ id: res.body.user.id, isAnonymous: true, username: null })

    const refreshed = await api('POST', '/api/v1/auth/refresh', { ip: ip(), body: { refreshToken } })
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.user).toMatchObject({ id: res.body.user.id, isAnonymous: true })
  })

  it('limits anonymous sign-ups per client address', async () => {
    const address = ip()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await api('POST', '/api/v1/auth/anonymous', { ip: address })).status)
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('logs in, refreshes (single-use tokens) and logs out', async () => {
    const address = email('login')
    await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: address, password: 'long enough 9' } })

    const wrong = await api('POST', '/api/v1/auth/login', { ip: ip(), body: { email: address, password: 'nope nope 9' } })
    expect(wrong.status).toBe(401)
    expect(wrong.body.code).toBe('invalid_credentials')

    // A stale or broken bearer on a sign-in route doesn't get in the way.
    const login = await api('POST', '/api/v1/auth/login', { ip: ip(), token: 'a.b.c', body: { email: address, password: 'long enough 9' } })
    expect(login.status).toBe(200)
    const { refreshToken, accessToken } = login.body.session

    const refreshed = await api('POST', '/api/v1/auth/refresh', { ip: ip(), body: { refreshToken } })
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.session.refreshToken).not.toBe(refreshToken)
    const reused = await api('POST', '/api/v1/auth/refresh', { ip: ip(), body: { refreshToken } })
    expect(reused.status).toBe(401)
    expect(reused.body.code).toBe('invalid_token')

    expect((await api('POST', '/api/v1/auth/logout', { ip: ip(), token: refreshed.body.session.accessToken })).status).toBe(204)
    const afterLogout = await api('POST', '/api/v1/auth/refresh', { ip: ip(), body: { refreshToken: refreshed.body.session.refreshToken } })
    expect(afterLogout.status).toBe(401)
    expect((await api('POST', '/api/v1/auth/logout', { ip: ip() })).status).toBe(401)
    expect(accessToken).toBeTruthy()
  })

  it('answers password-reset requests the same way whether or not the account exists', async () => {
    const known = email('known')
    await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: known, password: 'long enough 9' } })
    const a = await api('POST', '/api/v1/auth/password/forgot', { ip: ip(), body: { email: known } })
    const b = await api('POST', '/api/v1/auth/password/forgot', { ip: ip(), body: { email: email('nobody') } })
    expect([a.status, b.status]).toEqual([202, 202])
    expect(a.body).toEqual(b.body)
  })

  it('limits password guessing per account, across client addresses', async () => {
    const address = email('target')
    await api('POST', '/api/v1/auth/register', { ip: ip(), body: { email: address, password: 'long enough 9' } })
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await api('POST', '/api/v1/auth/login', { ip: ip(), body: { email: address, password: `guess ${i} wrong` } })).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it("moves the device's anonymous account into the account it registers", async () => {
    // The anonymous "wanderer" has a post, a comment, a block, a journey and a username.
    await api('PATCH', '/api/v1/me', { as: 'wanderer', body: { username: 'Wanderer' } })
    const post = await api('POST', '/api/v1/posts', { as: 'wanderer', body: { body: postBody('before signing up') } })
    await api('POST', `/api/v1/posts/${post.body.id}/comments`, { as: 'wanderer', body: { body: 'Note to self.' } })
    await api('PUT', `/api/v1/blocks/${USERS.bob}`, { as: 'wanderer' })
    await api('PUT', '/api/v1/journey', {
      as: 'wanderer',
      body: { snapshotAt: '2026-09-27T10:00:00Z', startedAt: null, checkIns: [{ day: '2026-09-26', outcome: 'victory', emotions: [], urge: null, reflectionToday: null, reflectionTomorrow: null, journal: 'Kept going.', recommitQuote: null, recordedAt: '2026-09-26T20:00:00Z' }], relapses: [], habitCompletions: [] },
    })

    const res = await api('POST', '/api/v1/auth/register', { as: 'wanderer', ip: ip(), body: { email: email('wanderer'), password: 'long enough 9' } })
    expect(res.status).toBe(201)
    expect(res.body.mergedAnonymousAccount).toBe(true)
    const token = res.body.session.accessToken

    const me = await api('GET', '/api/v1/me', { token })
    expect(me.body.username).toBe('Wanderer')
    expect((await api('GET', `/api/v1/posts/${post.body.id}`, { token })).body).toMatchObject({ isMine: true, author: { id: res.body.user.id } })
    const thread = await api('GET', `/api/v1/posts/${post.body.id}/comments`, { token })
    expect(thread.body.data[0]).toMatchObject({ isMine: true })
    expect((await api('GET', '/api/v1/blocks', { token })).body.data).toEqual([expect.objectContaining({ userId: USERS.bob })])
    expect((await api('GET', '/api/v1/journey', { token })).body.checkIns[0]).toMatchObject({ day: '2026-09-26', journal: 'Kept going.' })

    // The anonymous account is empty now: nothing is left behind or duplicated.
    const leftover = await api('GET', '/api/v1/journey', { as: 'wanderer' })
    expect(leftover.body.checkIns).toEqual([])
  })
})

describe('auth: sign in with Google', () => {
  let n = 0
  const ip = () => `172.17.${Math.floor(++n / 250)}.${n % 250}`
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')

  /** What Credential Manager hands the app: a Google ID token carrying sha256(rawNonce). */
  function googleToken(o: { sub: string; email: string; rawNonce: string; aud?: string; signature?: string; exp?: number }) {
    const claims = {
      iss: 'https://accounts.google.com',
      aud: o.aud ?? GOOGLE_WEB_CLIENT_ID,
      sub: o.sub,
      email: o.email,
      email_verified: true,
      name: 'Real Name From Google',
      nonce: sha256(o.rawNonce),
      iat: Math.floor(Date.now() / 1000),
      exp: o.exp ?? Math.floor(Date.now() / 1000) + 3600,
    }
    return `${b64({ alg: 'RS256', kid: 'google-key' })}.${b64(claims)}.${o.signature ?? GOOGLE_SIGNATURE}`
  }

  it('creates the account on first sign-in and finds it again, without importing the Google name', async () => {
    const rawNonce = uuid()
    const first = await api('POST', '/api/v1/auth/google', { ip: ip(), body: { idToken: googleToken({ sub: 'g-100', email: 'hiker@gmail.com', rawNonce }), nonce: rawNonce } })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ user: { email: 'hiker@gmail.com', isAnonymous: false }, mergedAnonymousAccount: false })

    const me = await api('GET', '/api/v1/me', { token: first.body.session.accessToken })
    expect(me.body).toMatchObject({ email: 'hiker@gmail.com', username: null, isAnonymous: false })

    const again = uuid()
    const second = await api('POST', '/api/v1/auth/google', { ip: ip(), body: { idToken: googleToken({ sub: 'g-100', email: 'hiker@gmail.com', rawNonce: again }), nonce: again } })
    expect(second.body.user.id).toBe(first.body.user.id)
  })

  it('refuses tokens that fail verification, all with the same answer', async () => {
    const rawNonce = uuid()
    const cases = [
      { idToken: googleToken({ sub: 'g-200', email: 'x@gmail.com', rawNonce }), nonce: uuid() }, // nonce of another attempt
      { idToken: googleToken({ sub: 'g-200', email: 'x@gmail.com', rawNonce, aud: 'someone-elses-app' }), nonce: rawNonce },
      { idToken: googleToken({ sub: 'g-200', email: 'x@gmail.com', rawNonce, signature: 'forged' }), nonce: rawNonce },
      { idToken: googleToken({ sub: 'g-200', email: 'x@gmail.com', rawNonce, exp: 1 }), nonce: rawNonce },
    ]
    for (const body of cases) {
      const res = await api('POST', '/api/v1/auth/google', { ip: ip(), body })
      expect(res.status).toBe(401)
      expect(res.body).toMatchObject({ code: 'invalid_credentials', detail: 'Google sign-in could not be verified. Try again.' })
    }
    const noNonce = await api('POST', '/api/v1/auth/google', { ip: ip(), body: { idToken: googleToken({ sub: 'g-200', email: 'x@gmail.com', rawNonce }) } })
    expect(noNonce.status).toBe(422)
    const notAJwt = await api('POST', '/api/v1/auth/google', { ip: ip(), body: { idToken: 'hello', nonce: rawNonce } })
    expect(notAJwt.status).toBe(422)
  })

  it("merges the device's anonymous account into the Google account", async () => {
    const post = await api('POST', '/api/v1/posts', { as: 'drifter', body: { body: postBody('drifting before google') } })
    const rawNonce = uuid()
    const res = await api('POST', '/api/v1/auth/google', {
      as: 'drifter',
      ip: ip(),
      body: { idToken: googleToken({ sub: 'g-300', email: 'drifter@gmail.com', rawNonce }), nonce: rawNonce },
    })
    expect(res.status).toBe(200)
    expect(res.body.mergedAnonymousAccount).toBe(true)
    const mine = await api('GET', `/api/v1/posts/${post.body.id}`, { token: res.body.session.accessToken })
    expect(mine.body).toMatchObject({ isMine: true, author: { id: res.body.user.id } })
  })
})

describe('seed data', () => {
  const seeded = (handle: string) => seedId(`user:${handle}`)

  it('fills the forum, and keeps hidden spam out of it', async () => {
    const feed = await api('GET', '/api/v1/posts?limit=50', { as: 'alice' })
    const byId = new Map(feed.body.data.map((p: { id: string }) => [p.id, p]))
    for (const p of SEED_POSTS) expect(byId.has(postId(p.key)), p.key).toBe(true)
    expect(byId.has(postId(SPAM_POST.key))).toBe(false)

    expect(byId.get(postId('day-47'))).toMatchObject({ commentCount: 2, author: { id: seeded('quiet_river'), name: 'quiet_river', streakDays: 47 } })
    expect(byId.get(postId('first-day'))).toMatchObject({ author: { name: 'anonymous' } })

    const thread = await api('GET', `/api/v1/posts/${postId('ninety-days')}/comments`, { as: 'alice' })
    expect(thread.body.data.map((c: { author: { name: string } }) => c.author.name)).toEqual(['small_steps', 'north_star', 'green_field', 'oak_and_iron'])
  })

  it('seeds moderation state: open and dismissed reports, a ban, a block', async () => {
    const mod = seeded('climbly_mod')
    const open = await api('GET', '/api/v1/moderation/reports', { as: mod })
    const spam = open.body.data.filter((r: { target: { id: string } }) => r.target.id === postId(SPAM_POST.key))
    expect(spam).toHaveLength(3)
    expect(spam[0].target).toMatchObject({ authorName: 'quick_cash_99', reportCount: 3 })
    expect(spam[0].target.hiddenAt).not.toBeNull()

    const dismissed = await api('GET', '/api/v1/moderation/reports?status=dismissed', { as: mod })
    expect(dismissed.body.data.some((r: { target: { id: string } }) => r.target.id === postId('fence'))).toBe(true)

    const banned = await api('POST', '/api/v1/posts', { as: seeded('quick_cash_99'), body: { body: 'Trying to post again after the ban.' } })
    expect(banned.body.code).toBe('banned')

    const blocks = await api('GET', '/api/v1/blocks', { as: seeded('small_steps') })
    expect(blocks.body.data).toEqual([expect.objectContaining({ userId: seeded('quick_cash_99') })])

    expect((await api('GET', '/api/v1/me', { as: seeded('climbly_admin') })).body.role).toBe('admin')
  })

  it('seeds journey backups', async () => {
    const journey = await api('GET', '/api/v1/journey', { as: seeded('quiet_river') })
    expect(journey.body.startedAt).not.toBeNull()
    expect(journey.body.checkIns.length).toBeGreaterThan(50)
    expect(journey.body.checkIns.filter((c: { outcome: string }) => c.outcome === 'setback')).toHaveLength(2)
    expect(journey.body.relapses).toHaveLength(2)
    expect(journey.body.habitCompletions.length).toBeGreaterThan(0)
    expect(journey.body.checkIns[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('android client contract', () => {
  // Exactly what the app's kotlinx.serialization setup sends: explicit nulls, every field present.
  it('accepts the payloads the app sends', async () => {
    const me = await api('PATCH', '/api/v1/me', { as: 'frank', body: { displayName: null } })
    expect(me.status).toBe(200)

    const post = await api('POST', '/api/v1/posts', { as: 'alice', body: { id: uuid(), body: postBody('contract'), streakDays: 0 } })
    expect(post.status).toBe(201)
    const report = await api('POST', '/api/v1/reports', {
      as: 'frank',
      body: { targetType: 'post', targetId: post.body.id, reason: 'other', details: null },
    })
    expect(report.status).toBe(202)

    const journey = await api('PUT', '/api/v1/journey', {
      as: 'frank',
      body: {
        snapshotAt: '2026-09-27T10:00:00.123Z',
        startedAt: null,
        checkIns: [
          {
            day: '2026-09-26',
            outcome: 'victory',
            emotions: ['CALM'],
            urge: null,
            reflectionToday: null,
            reflectionTomorrow: null,
            journal: null,
            recommitQuote: null,
            recordedAt: '2026-09-26T20:00:00Z',
          },
        ],
        relapses: [{ occurredAt: '2026-09-25T23:59:00Z', note: null }],
        habitCompletions: [{ habitId: 'walk', day: '2026-09-26' }],
      },
    })
    expect(journey.status).toBe(200)
  })

  it('accepts bodiless PUTs with Content-Length: 0 (Retrofit)', async () => {
    const res = await api('PUT', `/api/v1/blocks/${USERS.bob}`, { as: 'frank', headers: { 'content-length': '0' } })
    expect(res.status).toBe(204)
    await api('DELETE', `/api/v1/blocks/${USERS.bob}`, { as: 'frank' })
  })
})

describe('account deletion', () => {
  it('removes everything stored for the account', async () => {
    const post = await api('POST', '/api/v1/posts', { as: 'dave', body: { body: postBody('dave-last') } })
    expect(post.status).toBe(201)
    await api('PUT', '/api/v1/journey', { as: 'dave', body: { snapshotAt: '2026-09-27T10:00:00Z', startedAt: null, checkIns: [], relapses: [], habitCompletions: [] } })

    expect((await api('DELETE', '/api/v1/me', { as: 'dave' })).status).toBe(204)
    expect((await api('GET', `/api/v1/posts/${post.body.id}`, { as: 'alice' })).status).toBe(404)
    // In tests the auth user survives (no secret key), so the next call starts a fresh, empty profile.
    const fresh = await api('GET', '/api/v1/journey', { as: 'dave' })
    expect(fresh.body.snapshotAt).toBeNull()
  })
})
