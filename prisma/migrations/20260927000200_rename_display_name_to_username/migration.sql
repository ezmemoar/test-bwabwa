-- Hand-written: Prisma would generate DROP COLUMN + ADD COLUMN for this, losing every name. A rename keeps
-- the data; the CHECK constraint follows the column automatically and is renamed to match.
ALTER TABLE "profiles" RENAME COLUMN "display_name" TO "username";
ALTER TABLE "profiles" RENAME CONSTRAINT "profiles_display_name_len" TO "profiles_username_len";
