import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import type { Redis } from 'ioredis'
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible'

export interface RateLimitPolicy {
  /** Key prefix in the store; must be unique per policy. */
  name: string
  /** Requests allowed per window. */
  points: number
  /** Window length in seconds. */
  duration: number
  /** Once exceeded, keep rejecting for this many seconds (defaults to the rest of the window). */
  blockDuration?: number
}

/**
 * Every limit in one place. `ip` and `user` are applied to all /api/v1 traffic by middleware; the rest are
 * applied by the handlers they protect, on top of those.
 */
export const RateLimits = {
  ip: { name: 'ip', points: 300, duration: 60 },
  user: { name: 'user', points: 120, duration: 60 },
  postCreate: { name: 'post-create', points: 5, duration: 15 * 60 },
  commentCreate: { name: 'comment-create', points: 30, duration: 15 * 60 },
  report: { name: 'report', points: 20, duration: 60 * 60 },
  block: { name: 'block', points: 30, duration: 60 * 60 },
  profileWrite: { name: 'profile-write', points: 20, duration: 60 * 60 },
  journeyWrite: { name: 'journey-write', points: 60, duration: 60 * 60 },
  accountDelete: { name: 'account-delete', points: 3, duration: 60 * 60, blockDuration: 60 * 60 },
  moderation: { name: 'moderation', points: 600, duration: 60 },
  // Per client IP, on top of the per-user limits above (see rateLimitWrite). Roomy enough for a household or
  // an office behind one address, tight enough that minting accounts doesn't multiply what one client can do.
  postCreateIp: { name: 'post-create-ip', points: 20, duration: 15 * 60 },
  commentCreateIp: { name: 'comment-create-ip', points: 90, duration: 15 * 60 },
  reportIp: { name: 'report-ip', points: 40, duration: 60 * 60 },
  blockIp: { name: 'block-ip', points: 90, duration: 60 * 60 },
  profileWriteIp: { name: 'profile-write-ip', points: 60, duration: 60 * 60 },
  journeyWriteIp: { name: 'journey-write-ip', points: 240, duration: 60 * 60 },
  // Authentication. Login and password reset are also limited per email address (hashed), so one account
  // can't be guessed at from many IPs.
  authRegisterIp: { name: 'auth-register-ip', points: 10, duration: 60 * 60 },
  // A fresh install signs up once; reinstalls and cleared app data do it again.
  authAnonymousIp: { name: 'auth-anonymous-ip', points: 10, duration: 60 * 60 },
  authLoginIp: { name: 'auth-login-ip', points: 20, duration: 15 * 60 },
  authLoginEmail: { name: 'auth-login-email', points: 10, duration: 15 * 60, blockDuration: 15 * 60 },
  authRefreshIp: { name: 'auth-refresh-ip', points: 120, duration: 15 * 60 },
  authRecoverIp: { name: 'auth-recover-ip', points: 5, duration: 60 * 60 },
  authRecoverEmail: { name: 'auth-recover-email', points: 3, duration: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>

let redis: Redis | null | undefined
const limiters = new Map<string, RateLimiterAbstract>()

async function redisClient(): Promise<Redis | null> {
  if (redis !== undefined) return redis
  const { redisUrl } = useConfig()
  if (!redisUrl) return (redis = null)
  const { Redis } = await import('ioredis')
  // No offline queue: while Redis is down, calls fail fast and the in-memory insurance limiter takes over.
  redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: false })
  redis.on('error', (error) => log.warn('redis error', serializeError(error)))
  return redis
}

async function limiterFor(policy: RateLimitPolicy): Promise<RateLimiterAbstract> {
  const existing = limiters.get(policy.name)
  if (existing) return existing
  const options = {
    keyPrefix: `rl:${policy.name}`,
    points: policy.points,
    duration: policy.duration,
    blockDuration: policy.blockDuration,
  }
  const store = await redisClient()
  const limiter = store
    ? new RateLimiterRedis({ ...options, storeClient: store, rejectIfRedisNotReady: true, insuranceLimiter: new RateLimiterMemory(options) })
    : new RateLimiterMemory(options)
  limiters.set(policy.name, limiter)
  return limiter
}

function setHeaders(event: H3Event, policy: RateLimitPolicy, res: RateLimiterRes) {
  // IETF draft-ietf-httpapi-ratelimit-headers. Later (more specific) policies overwrite earlier ones.
  const reset = Math.max(0, Math.ceil(res.msBeforeNext / 1000))
  setResponseHeaders(event, {
    'RateLimit-Policy': `${policy.points};w=${policy.duration}`,
    'RateLimit-Limit': String(policy.points),
    'RateLimit-Remaining': String(Math.max(0, res.remainingPoints)),
    'RateLimit-Reset': String(reset),
  })
}

/**
 * Consumes one point for `key` under `policy`, or throws 429 with Retry-After. If the store itself fails the
 * request is let through: an outage of the limiter must not become an outage of the API.
 */
export async function rateLimit(event: H3Event, policy: RateLimitPolicy, key: string): Promise<void> {
  const limiter = await limiterFor(policy)
  try {
    setHeaders(event, policy, await limiter.consume(key))
  } catch (rejection) {
    if (!(rejection instanceof RateLimiterRes)) {
      log.error('rate limiter failure', { policy: policy.name, ...serializeError(rejection) })
      return
    }
    setHeaders(event, policy, rejection)
    const retryAfter = Math.max(1, Math.ceil(rejection.msBeforeNext / 1000))
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw problem(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfter, policy: policy.name })
  }
}

/** Per-user limit for a specific action; the caller must be authenticated. */
export function rateLimitUser(event: H3Event, policy: RateLimitPolicy): Promise<void> {
  return rateLimit(event, policy, requireUser(event).id)
}

/**
 * The address rate limits are keyed by. Each trusted proxy appends the address it received the request from
 * to X-Forwarded-For, so the real client is `trustProxy` entries from the right. Everything further left came
 * from the client and is ignored. (h3's getRequestIP takes the leftmost entry, which anyone can forge to get
 * a fresh rate-limit bucket per request.)
 */
/** Rate-limit key for an email address: hashed, so addresses never sit in memory or Redis in the clear. */
export function emailKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('base64url')
}

export function clientIp(event: H3Event): string {
  const hops = useConfig().trustProxy
  const socketIp = event.node.req.socket.remoteAddress ?? 'unknown'
  if (hops === 0) return socketIp
  const chain = (getRequestHeader(event, 'x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Shorter than expected: the request didn't come through all the proxies, so trust only the socket.
  return chain[chain.length - hops] ?? socketIp
}

/**
 * Per-user limits alone can be sidestepped by signing up more (free, anonymous) accounts, so writes are also
 * capped per client IP. The IP check runs first, so the more specific per-user headers are the ones returned.
 */
export async function rateLimitWrite(event: H3Event, userPolicy: RateLimitPolicy, ipPolicy: RateLimitPolicy): Promise<void> {
  await rateLimit(event, ipPolicy, clientIp(event))
  await rateLimitUser(event, userPolicy)
}

export async function closeRateLimitStore(): Promise<void> {
  const r = redis
  redis = undefined
  limiters.clear()
  await r?.quit().catch(() => {})
}
