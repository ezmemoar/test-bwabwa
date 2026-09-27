-- Hand-written. Prisma's own bookkeeping table lives in `public` too. Its privileges are already revoked
-- from the API roles; RLS closes it the same way as every other table (and keeps Supabase's Security
-- Advisor quiet). Prisma writes it as the table owner, which RLS doesn't restrict.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
