import { createHash } from 'node:crypto'

// Seed fixtures: a small, believable forum plus moderation state and journey backups, so every table and every
// screen has something in it. All ids are derived from names, so re-running the seed updates rather than
// duplicates.

/** Deterministic UUID (v5 layout) from a label. */
export function seedId(label: string): string {
  const h = createHash('sha1').update(`climbly-seed:${label}`).digest()
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type SeedRole = 'user' | 'moderator' | 'admin'

export interface SeedUser {
  handle: string
  username: string | null
  role: SeedRole
  streakDays: number
  banned?: { reason: string }
}

export const SEED_USERS: SeedUser[] = [
  { handle: 'quiet_river', username: 'quiet_river', role: 'user', streakDays: 47 },
  { handle: 'north_star', username: 'north_star', role: 'user', streakDays: 12 },
  { handle: 'oak_and_iron', username: 'oak_and_iron', role: 'user', streakDays: 90 },
  { handle: 'small_steps', username: 'small_steps', role: 'user', streakDays: 3 },
  { handle: 'green_field', username: 'green_field', role: 'user', streakDays: 30 },
  { handle: 'steady_hand', username: 'steady_hand', role: 'user', streakDays: 61 },
  { handle: 'harbor_light', username: 'harbor_light', role: 'user', streakDays: 7 },
  { handle: 'iron_will_22', username: 'iron_will_22', role: 'user', streakDays: 120 },
  /** Posts anonymously (no display name). */
  { handle: 'anonymous_climber', username: null, role: 'user', streakDays: 1 },
  { handle: 'quick_cash_99', username: 'quick_cash_99', role: 'user', streakDays: 0, banned: { reason: 'Spam' } },
  { handle: 'climbly_mod', username: 'Climbly team', role: 'moderator', streakDays: 200 },
  { handle: 'climbly_admin', username: null, role: 'admin', streakDays: 0 },
]

export const seedEmail = (handle: string) => `${handle}@seed.climbly.example.com`

const HOUR = 3_600_000
const DAY = 24 * HOUR

export interface SeedComment {
  key: string
  author: string
  body: string
  ago: number
}

export interface SeedPost {
  key: string
  author: string
  body: string
  ago: number
  comments: SeedComment[]
}

export const SEED_POSTS: SeedPost[] = [
  {
    key: 'day-47',
    author: 'quiet_river',
    ago: 2 * HOUR,
    body: "Day 47. Had a rough evening yesterday, the urge came out of nowhere while I was just lying in bed. Got up, did 30 push-ups, cold shower, and it passed. Sharing so someone else knows it's possible.",
    comments: [
      { key: 'get-up', author: 'north_star', ago: 90 * 60_000, body: "The 'get up immediately' move is everything. Staying in bed is where it always went wrong for me." },
      { key: 'proud', author: 'oak_and_iron', ago: 40 * 60_000, body: 'Proud of you. 47 is huge.' },
    ],
  },
  {
    key: 'last-vpn',
    author: 'north_star',
    ago: 6 * HOUR,
    body: "Uninstalled the last VPN app on my phone today. Felt weird deleting it, like I was closing a back door I'd been keeping 'just in case'. That 'just in case' was the problem.",
    comments: [{ key: 'back-door', author: 'quiet_river', ago: 5 * HOUR, body: 'That back door mindset is so real. Respect.' }],
  },
  {
    key: 'ninety-days',
    author: 'oak_and_iron',
    ago: 1 * DAY,
    body: "90 days. I don't want to overhype it but: sleep is better, I look people in the eye, my brain is quieter. It was not linear. I relapsed twice in the first month. Keep going.",
    comments: [
      { key: 'not-linear', author: 'small_steps', ago: 20 * HOUR, body: "Needed to hear the 'not linear' part today. Thank you." },
      { key: 'legend', author: 'north_star', ago: 18 * HOUR, body: 'Legend.' },
      { key: 'month-one', author: 'green_field', ago: 10 * HOUR, body: 'What helped most in month one?' },
      { key: 'kitchen', author: 'oak_and_iron', ago: 9 * HOUR, body: 'Honestly: phone charges in the kitchen, not the bedroom. Boring but it worked.' },
    ],
  },
  {
    key: 'reset',
    author: 'small_steps',
    ago: 1 * DAY + 3 * HOUR,
    body: 'Relapsed on day 21 and felt like garbage for two days. Reset the counter today instead of pretending. Day 3 again. Not giving up.',
    comments: [
      { key: 'honest-reset', author: 'oak_and_iron', ago: 1 * DAY, body: 'Resetting honestly IS the win. The streak number matters less than the fact you came back.' },
    ],
  },
  {
    key: 'name-it',
    author: 'green_field',
    ago: 2 * DAY,
    body: "Tip that worked for me: the moment I notice an urge I say out loud 'that's an urge'. Naming it makes it feel like weather instead of a decision.",
    comments: [],
  },
  {
    key: 'guitar',
    author: 'steady_hand',
    ago: 3 * DAY,
    body: 'Two months. The biggest surprise is how much free time I have. Started learning guitar with it.',
    comments: [{ key: 'build', author: 'green_field', ago: 2 * DAY + 4 * HOUR, body: 'Replacing the habit with something you build is the way.' }],
  },
  {
    key: 'flatline',
    author: 'harbor_light',
    ago: 4 * DAY,
    body: 'One week. Flatline is real, feel kind of numb and unmotivated. Anyone else go through this around week 1-2?',
    comments: [
      { key: 'it-lifts', author: 'steady_hand', ago: 4 * DAY - 2 * HOUR, body: 'Yes. Mine lasted about ten days. It lifts. Keep exercising through it.' },
      { key: 'week-3', author: 'quiet_river', ago: 3 * DAY, body: 'Week 2 for me was the worst, week 3 was noticeably better.' },
    ],
  },
  {
    key: 'fence',
    author: 'iron_will_22',
    ago: 6 * DAY,
    body: "Four months. For anyone starting: the blocker isn't a cage, it's a fence around a garden. It gives you space to grow something.",
    comments: [],
  },
  {
    key: 'first-day',
    author: 'anonymous_climber',
    ago: 30 * 60_000,
    body: "First day. Not ready to use a name yet. Just wanted to say it out loud somewhere: I'm done with this.",
    comments: [{ key: 'welcome', author: 'climbly_mod', ago: 20 * 60_000, body: "Welcome. Day one is the hardest foothold. We're glad you're here." }],
  },
]

/** Hidden by reports: shows up in the moderation queue. Its author is banned. */
export const SPAM_POST: SeedPost = {
  key: 'spam',
  author: 'quick_cash_99',
  ago: 8 * HOUR,
  body: 'Want to make fast money from home? Message me for the secret method, only a few spots left.',
  comments: [],
}
export const SPAM_REPORTERS = ['quiet_river', 'north_star', 'green_field']

/** A report a moderator already looked at and dismissed. */
export const DISMISSED_REPORT = { reporter: 'harbor_light', post: 'fence', comment: null as string | null, reason: 'other' as const }

export const SEED_BLOCKS: [blocker: string, blocked: string][] = [['small_steps', 'quick_cash_99']]

export const postId = (key: string) => seedId(`post:${key}`)
export const commentId = (postKey: string, key: string) => seedId(`comment:${postKey}:${key}`)

// Journey backups: what the app uploads when "Back up your journey" is on.

export const HABIT_IDS = ['exercise', 'cold_shower', 'healthy_meal', 'sleep', 'no_phone_bed', 'meditate', 'read', 'walk']
export const VICTORY_EMOTIONS = ['Hopeful', 'Peaceful', 'Grateful', 'Motivated', 'Content', 'Encouraged']
export const SETBACK_EMOTIONS = ['Lonely', 'Stressed', 'Regretful', 'Exhausted']

export interface SeedJourney {
  handle: string
  /** Days since the journey started. */
  length: number
  /** Relapses, as days ago (logged at 23:59 that day). */
  relapsesDaysAgo: number[]
}

export const SEED_JOURNEYS: SeedJourney[] = [
  { handle: 'quiet_river', length: 75, relapsesDaysAgo: [48, 62] },
  { handle: 'green_field', length: 34, relapsesDaysAgo: [31] },
  { handle: 'small_steps', length: 26, relapsesDaysAgo: [3] },
]
