import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '~~/server/generated/prisma/client'

export type Db = PrismaClient
/** The client handed to interactive transaction callbacks. */
export type Tx = Prisma.TransactionClient

let prisma: PrismaClient | undefined

/**
 * One Prisma client (and one node-postgres pool) per server process. Prisma 7 runs without a query engine
 * binary; the `pg` driver adapter talks to Supabase directly. node-postgres uses unnamed prepared statements,
 * so this works through Supabase's transaction pooler (port 6543) as well as the session pooler.
 */
export function usePrisma(): PrismaClient {
  if (prisma) return prisma
  const { databaseUrl, databasePoolMax, databaseCa } = useConfig().supabase
  const connection = databaseConnection(databaseUrl, databaseCa)
  if (connection.encrypted && !connection.verified) {
    log.warn('database TLS is encrypted but the server certificate is not verified; set NUXT_SUPABASE_DATABASE_CA')
  }
  const adapter = new PrismaPg({
    connectionString: connection.connectionString,
    ssl: connection.ssl,
    max: databasePoolMax,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    maxLifetimeSeconds: 30 * 60,
    application_name: 'climbly-api',
  })
  // Warnings go through our JSON logger. Query errors are not logged here: they're thrown to the caller, which
  // either handles them on purpose (a unique race, a missing FK target) or lets the error handler log them.
  const client = new PrismaClient({ adapter, log: [{ emit: 'event', level: 'warn' }] })
  client.$on('warn', (e) => log.warn('prisma', { message: e.message }))
  prisma = client as unknown as PrismaClient
  return prisma
}

export async function closePrisma(): Promise<void> {
  const client = prisma
  prisma = undefined
  await client?.$disconnect()
}

/** Prisma's error code (P2002 unique violation, P2003 foreign key, P2025 not found), if it is one. */
export function prismaCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined
}

export const UNIQUE_VIOLATION = 'P2002'
export const FOREIGN_KEY_VIOLATION = 'P2003'

/** `@db.Date` columns come back as UTC midnight; the API speaks YYYY-MM-DD. */
export const toDay = (d: Date) => d.toISOString().slice(0, 10)
export const fromDay = (day: string) => new Date(`${day}T00:00:00.000Z`)
