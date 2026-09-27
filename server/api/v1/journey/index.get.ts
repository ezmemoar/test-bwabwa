defineRouteMeta({
  openAPI: { tags: ['journey'], summary: 'The last journey backup, for restoring on a new device', security: [{ bearer: [] }] },
})

export default defineEventHandler(async (event) => {
  const me = await useProfile(event)
  const prisma = usePrisma()
  const where = { userId: me.id }

  const [checkIns, relapses, habits] = await Promise.all([
    prisma.checkIn.findMany({ where, orderBy: { day: 'asc' } }),
    prisma.relapse.findMany({ where, orderBy: { occurredAt: 'asc' } }),
    prisma.habitCompletion.findMany({ where, orderBy: [{ day: 'asc' }, { habitId: 'asc' }] }),
  ])

  return {
    snapshotAt: me.journeySnapshotAt?.toISOString() ?? null,
    startedAt: me.journeyStartedAt?.toISOString() ?? null,
    checkIns: checkIns.map(({ userId: _u, day, recordedAt, ...c }) => ({ ...c, day: toDay(day), recordedAt: recordedAt.toISOString() })),
    relapses: relapses.map((r) => ({ occurredAt: r.occurredAt.toISOString(), note: r.note })),
    habitCompletions: habits.map((h) => ({ habitId: h.habitId, day: toDay(h.day) })),
  }
})
