defineRouteMeta({
  openAPI: {
    tags: ['journey'],
    summary: 'Back up the whole journey (replaces the stored copy)',
    description:
      'Check-ins, relapses and habit completions are replaced atomically. A snapshot older than the stored one is rejected with 409 `stale_snapshot`, so a delayed retry can never overwrite newer data.',
    security: [{ bearer: [] }],
  },
})

export default defineEventHandler(async (event) => {
  const me = await useProfile(event)
  await rateLimitWrite(event, RateLimits.journeyWrite, RateLimits.journeyWriteIp)
  const snapshot = await validBody(event, journeySnapshotSchema)
  const snapshotAt = new Date(snapshot.snapshotAt)
  const userId = me.id

  await usePrisma().$transaction(
    async (tx) => {
      // Row lock: concurrent uploads from the same account are applied one after the other.
      const [current] = await tx.$queryRaw<{ journey_snapshot_at: Date | null }[]>`
        SELECT journey_snapshot_at FROM public.profiles WHERE id = ${userId}::uuid FOR UPDATE`
      if (current?.journey_snapshot_at && current.journey_snapshot_at > snapshotAt) {
        throw conflict('A newer backup already exists.', 'stale_snapshot')
      }

      await tx.checkIn.deleteMany({ where: { userId } })
      await tx.relapse.deleteMany({ where: { userId } })
      await tx.habitCompletion.deleteMany({ where: { userId } })

      for (const rows of chunkRows(snapshot.checkIns)) {
        await tx.checkIn.createMany({
          data: rows.map((c) => ({ ...c, userId, day: fromDay(c.day), recordedAt: new Date(c.recordedAt) })),
        })
      }
      for (const rows of chunkRows(snapshot.relapses)) {
        await tx.relapse.createMany({ data: rows.map((r) => ({ userId, occurredAt: new Date(r.occurredAt), note: r.note })) })
      }
      for (const rows of chunkRows(snapshot.habitCompletions)) {
        await tx.habitCompletion.createMany({
          data: rows.map((h) => ({ userId, habitId: h.habitId, day: fromDay(h.day) })),
          skipDuplicates: true,
        })
      }

      await tx.profile.update({
        where: { id: userId },
        data: { journeySnapshotAt: snapshotAt, journeyStartedAt: snapshot.startedAt ? new Date(snapshot.startedAt) : null },
      })
    },
    // A multi-year snapshot is a few thousand rows; give it room without holding a connection forever.
    { maxWait: 5_000, timeout: 20_000 },
  )

  return {
    snapshotAt: snapshotAt.toISOString(),
    counts: {
      checkIns: snapshot.checkIns.length,
      relapses: snapshot.relapses.length,
      habitCompletions: snapshot.habitCompletions.length,
    },
  }
})
