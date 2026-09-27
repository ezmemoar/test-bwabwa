// Dev helper: an in-memory Postgres (PGlite) with Supabase's auth schema stubbed, on 127.0.0.1:$PORT.
// `node tests/pglite-server.mjs 54329` then point NUXT_DATABASE_URL at postgres://postgres:postgres@127.0.0.1:54329/postgres
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const port = Number(process.argv[2] ?? 54329)
const db = await PGlite.create()
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
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' })
await server.start()
console.log(`pglite listening on 127.0.0.1:${port}`)
const stop = async () => { await server.stop(); await db.close(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
