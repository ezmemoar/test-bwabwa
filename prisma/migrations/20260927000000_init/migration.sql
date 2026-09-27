-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'moderator', 'admin');

-- CreateEnum
CREATE TYPE "report_target" AS ENUM ('post', 'comment');

-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('spam', 'harassment', 'sexual_content', 'self_harm', 'other');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'dismissed', 'actioned');

-- CreateEnum
CREATE TYPE "check_in_outcome" AS ENUM ('victory', 'setback');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "display_name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "banned_until" TIMESTAMPTZ(3),
    "ban_reason" TEXT,
    "journey_started_at" TIMESTAMPTZ(3),
    "journey_snapshot_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_streak_days" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "hidden_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "hidden_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_type" "report_target" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" "report_reason" NOT NULL,
    "details" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "outcome" "check_in_outcome" NOT NULL,
    "emotions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "urge" SMALLINT,
    "reflection_today" TEXT,
    "reflection_tomorrow" TEXT,
    "journal" TEXT,
    "recommit_quote" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateTable
CREATE TABLE "relapses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "relapses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_completions" (
    "user_id" UUID NOT NULL,
    "habit_id" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "habit_completions_pkey" PRIMARY KEY ("user_id","habit_id","day")
);

-- CreateIndex
CREATE INDEX "posts_feed_idx" ON "posts"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "posts_author_idx" ON "posts"("author_id");

-- CreateIndex
CREATE INDEX "comments_thread_idx" ON "comments"("post_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "comments_author_idx" ON "comments"("author_id");

-- CreateIndex
CREATE INDEX "reports_queue_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_once_per_reporter" ON "reports"("reporter_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks"("blocked_id");

-- CreateIndex
CREATE INDEX "relapses_user_idx" ON "relapses"("user_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relapses" ADD CONSTRAINT "relapses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_completions" ADD CONSTRAINT "habit_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

