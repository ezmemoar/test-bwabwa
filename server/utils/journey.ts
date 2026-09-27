import { z } from 'zod'

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v : null))

export const checkInSchema = z.object({
  /** Local calendar day, YYYY-MM-DD. */
  day: z.iso.date(),
  outcome: z.enum(['victory', 'setback']),
  emotions: z.array(z.string().min(1).max(40)).max(30).default([]),
  urge: z.int().min(0).max(10).nullish().transform((v) => v ?? null),
  reflectionToday: optionalText(2000),
  reflectionTomorrow: optionalText(2000),
  journal: optionalText(5000),
  recommitQuote: optionalText(500),
  recordedAt: z.iso.datetime({ offset: true }),
})

export const relapseSchema = z.object({
  occurredAt: z.iso.datetime({ offset: true }),
  note: optionalText(1000),
})

export const habitCompletionSchema = z.object({
  habitId: z.string().min(1).max(64),
  day: z.iso.date(),
})

/** A full backup: it replaces whatever the server held for this user. */
export const journeySnapshotSchema = z
  .object({
    /** Device time when the snapshot was taken; older snapshots than the stored one are rejected. */
    snapshotAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    checkIns: z.array(checkInSchema).max(4000),
    relapses: z.array(relapseSchema).max(5000),
    habitCompletions: z.array(habitCompletionSchema).max(30_000),
  })
  .superRefine((s, ctx) => {
    const days = new Set<string>()
    for (const [i, c] of s.checkIns.entries()) {
      if (days.has(c.day)) ctx.addIssue({ code: 'custom', path: ['checkIns', i, 'day'], message: 'duplicate day' })
      days.add(c.day)
    }
  })

export type JourneySnapshot = z.output<typeof journeySnapshotSchema>

/** Splits rows so a single INSERT stays far below Postgres' 65 535 bind-parameter limit. */
export function chunkRows<T>(rows: T[], size = 1000): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}
