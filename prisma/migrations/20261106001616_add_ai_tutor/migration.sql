-- CreateEnum
CREATE TYPE "AiPool" AS ENUM ('TUTOR', 'PLATFORM');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('PENDING', 'OK', 'FAILED');

-- CreateEnum
CREATE TYPE "TutorMode" AS ENUM ('GUIDE', 'SHOW');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('PREFERENCE', 'MISCONCEPTION', 'STRENGTH', 'STRUGGLE');

-- CreateEnum
CREATE TYPE "PracticeEvidence" AS ENUM ('PASSED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ai_request" (
    "id" TEXT NOT NULL,
    "pool" "AiPool" NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "userId" TEXT,
    "status" "AiRequestStatus" NOT NULL DEFAULT 'PENDING',
    "day" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "thoughtTokens" INTEGER NOT NULL DEFAULT 0,
    "listCostMicros" INTEGER NOT NULL DEFAULT 0,
    "traceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor_profile" (
    "userId" TEXT NOT NULL,
    "mode" "TutorMode" NOT NULL DEFAULT 'GUIDE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tutor_profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "tutor_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT,
    "notebookPath" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tutor_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor_message" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "actions" JSONB,
    "model" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "skill" TEXT,
    "sourceSessionId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "learner_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_request" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "evidence" "PracticeEvidence" NOT NULL,
    "lessonId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_request_day_model_pool_idx" ON "ai_request"("day", "model", "pool");

-- CreateIndex
CREATE INDEX "ai_request_model_createdAt_idx" ON "ai_request"("model", "createdAt");

-- CreateIndex
CREATE INDEX "ai_request_userId_day_idx" ON "ai_request"("userId", "day");

-- CreateIndex
CREATE INDEX "tutor_session_userId_notebookPath_updatedAt_idx" ON "tutor_session"("userId", "notebookPath", "updatedAt");

-- CreateIndex
CREATE INDEX "tutor_message_sessionId_createdAt_idx" ON "tutor_message"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "learner_memory_userId_supersededAt_idx" ON "learner_memory"("userId", "supersededAt");

-- CreateIndex
CREATE INDEX "practice_request_userId_createdAt_idx" ON "practice_request"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "tutor_profile" ADD CONSTRAINT "tutor_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_session" ADD CONSTRAINT "tutor_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_session" ADD CONSTRAINT "tutor_session_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_message" ADD CONSTRAINT "tutor_message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "tutor_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory" ADD CONSTRAINT "learner_memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_request" ADD CONSTRAINT "practice_request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
