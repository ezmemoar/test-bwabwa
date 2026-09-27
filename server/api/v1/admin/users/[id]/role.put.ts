import { z } from 'zod'
import { UserRole } from '~~/server/generated/prisma/enums'

defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: "Change a user's role (admins)",
    description: 'Takes effect on the next request; roles are read from the database, not from tokens.',
    security: [{ bearer: [] }],
  },
})

const body = z.object({ role: z.enum(UserRole) })

export default defineEventHandler(async (event) => {
  const admin = await requireRole(event, 'admin')
  await rateLimitUser(event, RateLimits.moderation)
  const { id } = validParams(event, idParam)
  const { role } = await validBody(event, body)
  // Keeps at least one admin around: nobody can demote themselves.
  if (id === admin.id) throw problem(422, 'validation_failed', 'You cannot change your own role.')

  const { count } = await usePrisma().profile.updateMany({ where: { id }, data: { role } })
  if (count === 0) throw notFound('User')

  log.info('role changed', { adminId: admin.id, userId: id, role })
  return { userId: id, role }
})
