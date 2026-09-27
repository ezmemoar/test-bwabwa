-- Hand-written: what Prisma doesn't model. Prisma's diff ignores RLS, CHECK constraints and grants, so these
-- never show up as drift.

-- Row Level Security with no policies on every table. The Supabase anon key ships inside the Android app, so
-- nothing in `public` may be reachable through PostgREST/GraphQL. The API connects as the table owner, which
-- bypasses RLS, and enforces access itself.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "check_ins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "relapses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habit_completions" ENABLE ROW LEVEL SECURITY;

-- Belt and braces: drop the table privileges Supabase grants the API roles by default, now and for future tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Invariants the database enforces even if a bug slips past the API's validation.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_display_name_len"
  CHECK ("display_name" IS NULL OR char_length("display_name") BETWEEN 2 AND 24);
ALTER TABLE "posts" ADD CONSTRAINT "posts_body_len" CHECK (char_length("body") BETWEEN 10 AND 1000);
ALTER TABLE "posts" ADD CONSTRAINT "posts_counts_non_negative" CHECK ("comment_count" >= 0 AND "report_count" >= 0);
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_len" CHECK (char_length("body") BETWEEN 1 AND 500);
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_not_self" CHECK ("blocker_id" <> "blocked_id");
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_urge_range" CHECK ("urge" IS NULL OR "urge" BETWEEN 0 AND 10);
