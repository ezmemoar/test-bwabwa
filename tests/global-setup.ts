import { spawn, type ChildProcess } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { exportJWK, generateKeyPair, type JWK } from 'jose'
import type { TestProject } from 'vitest/node'
import { ANON_KEY, createFakeSupabaseAuth } from './fake-supabase-auth'

// End-to-end harness: an in-memory Postgres (PGlite) spoken to over the real wire protocol, the migrations
// exactly as they would run on Supabase, a stand-in for Supabase Auth's JWKS endpoint, and the production
// build (`.output`) as a child process.

/** Legacy-style HS256 secret; tokens signed with it exercise the fallback path. */
export const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters'

export const USERS = {
  alice: '00000000-0000-4000-8000-00000000000a',
  bob: '00000000-0000-4000-8000-00000000000b',
  carol: '00000000-0000-4000-8000-00000000000c',
  dave: '00000000-0000-4000-8000-00000000000d',
  erin: '00000000-0000-4000-8000-00000000000e',
  frank: '00000000-0000-4000-8000-00000000000f',
  mod: '00000000-0000-4000-8000-0000000000aa',
  admin: '00000000-0000-4000-8000-0000000000bb',
  /** Has a valid token but no auth.users row (a deleted account). */
  ghost: '00000000-0000-4000-8000-0000000000cc',
  /** Brand-new accounts (no profile yet, so it's created "now"): their reports must not auto-hide anything. */
  newbie1: '00000000-0000-4000-8000-0000000000d1',
  newbie2: '00000000-0000-4000-8000-0000000000d2',
  newbie3: '00000000-0000-4000-8000-0000000000d3',
  /** An anonymous device account with content, later merged into a registered one. */
  wanderer: '00000000-0000-4000-8000-0000000000e1',
  /** Another anonymous device account, merged through Google sign-in. */
  drifter: '00000000-0000-4000-8000-0000000000e2',
} as const

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
    supabaseUrl: string
    /** Private key matching the JWKS the fake Supabase serves (ES256, like current Supabase projects). */
    signingKey: JWK
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })
}

async function waitFor(url: string, child: ChildProcess, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API server exited early with code ${child.exitCode}`)
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`API server did not become ready at ${url}`)
}

export default async function setup(project: TestProject) {
  const db = await PGlite.create()

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const kid = 'test-key-1'
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }
  const authPort = await freePort()
  const supabaseUrl = `http://127.0.0.1:${authPort}`
  const handleAuth = createFakeSupabaseAuth({ db, privateKey, kid, publicJwk, issuer: () => supabaseUrl })
  const auth = createHttpServer((req, res) => {
    handleAuth(req, res).catch((error) => res.writeHead(500).end(String(error)))
  })
  await new Promise<void>((resolve) => auth.listen(authPort, '127.0.0.1', resolve))
  project.provide('supabaseUrl', supabaseUrl)
  project.provide('signingKey', { ...(await exportJWK(privateKey)), kid, alg: 'ES256' })

  // What Supabase provides and the migrations rely on.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email varchar(255));
    -- More of Supabase's auth schema, so tooling that trips over it (Prisma's "database not empty" or drift checks) fails here too.
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE TABLE auth.identities (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE TYPE auth.aal_level AS ENUM ('aal1', 'aal2', 'aal3');
  `)
  const pgPort = await freePort()
  const pgServer = new PGLiteSocketServer({ db, port: pgPort, host: '127.0.0.1' })
  await pgServer.start()
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`

  // Every database/Supabase variable is set explicitly. The tooling also reads backend/.env (dotenv never
  // overrides what's already set), and that file points at a real Supabase project the tests must not touch.
  const isolatedEnv = {
    MIGRATION_DATABASE_URL: databaseUrl,
    NUXT_SUPABASE_DATABASE_URL: databaseUrl,
    NUXT_SUPABASE_DIRECT_URL: databaseUrl,
    NUXT_SUPABASE_DATABASE_CA: '',
    NUXT_SUPABASE_URL: supabaseUrl,
    NUXT_SUPABASE_ANON_KEY: ANON_KEY,
    NUXT_SUPABASE_SECRET_KEY: '',
    NUXT_SUPABASE_JWT_SECRET: JWT_SECRET,
    NUXT_REDIS_URL: '',
    SHADOW_DATABASE_URL: '',
  }

  // The real tooling, as in production: Prisma applies the migrations, then the seeder runs twice (the second
  // run must converge on the same data, not fail or duplicate).
  const root = join(import.meta.dirname, '..')
  // Async on purpose: PGlite serves from this process's event loop, so a blocking spawnSync would deadlock.
  const run = (script: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, script), ...args], {
        cwd: root,
        env: {
          ...process.env,
          ...isolatedEnv,
          NODE_ENV: 'test',
          SEED_AUTH: 'direct',
        },
      })
      let output = ''
      child.stdout.on('data', (d) => (output += d))
      child.stderr.on('data', (d) => (output += d))
      child.on('error', reject)
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} ${args.join(' ')} failed (${code}):\n${output}`))))
    })
  await run('node_modules/prisma/build/index.js', ['migrate', 'deploy'])
  await run('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts'])
  await run('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts'])

  // Migration invariant: deleting a Supabase user deletes their profile (the auth.users trigger).
  const probe = '99999999-9999-4999-8999-999999999999'
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [probe])
  await db.query('INSERT INTO profiles (id) VALUES ($1)', [probe])
  await db.query('DELETE FROM auth.users WHERE id = $1', [probe])
  if ((await db.query('SELECT 1 FROM profiles WHERE id = $1', [probe])).rows.length) throw new Error('auth.users delete trigger did not remove the profile')

  const known = Object.entries(USERS).filter(([name]) => name !== 'ghost')
  for (const [, id] of known) await db.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
  // Regular test users are "established" accounts (a week old), so their reports count toward auto-hiding.
  const established = known.filter(([name]) => !name.startsWith('newbie'))
  for (const [name, id] of established) {
    const role = name === 'mod' ? 'moderator' : name === 'admin' ? 'admin' : 'user'
    await db.query(`INSERT INTO profiles (id, role, created_at) VALUES ($1, $2::user_role, now() - interval '7 days')`, [id, role])
  }

  const apiPort = await freePort()
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', '.output', 'server', 'index.mjs')], {
    env: {
      ...process.env,
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      ...isolatedEnv,
      NODE_ENV: 'production',
      NUXT_SUPABASE_DATABASE_POOL_MAX: '1',
      NUXT_TRUST_PROXY: 'true',
      NUXT_LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'error',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  const baseUrl = `http://127.0.0.1:${apiPort}`
  await waitFor(`${baseUrl}/api/health`, child)
  project.provide('baseUrl', baseUrl)

  return async () => {
    child.kill('SIGTERM')
    await new Promise((r) => child.once('exit', r))
    await pgServer.stop()
    await new Promise((resolve) => auth.close(resolve))
    await db.close()
  }
}
