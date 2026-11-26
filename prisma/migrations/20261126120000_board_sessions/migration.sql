-- CreateEnum
CREATE TYPE "BoardSessionStatus" AS ENUM ('OPEN', 'ENDED');

-- CreateTable
CREATE TABLE "board_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "skillKey" TEXT,
    "language" TEXT NOT NULL,
    "didactraSession" TEXT,
    "status" "BoardSessionStatus" NOT NULL DEFAULT 'OPEN',
    "minutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "model" TEXT,
    "voice" TEXT,
    "summary" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_session_event" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_session_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_session_userId_lessonId_skillKey_createdAt_idx" ON "board_session"("userId", "lessonId", "skillKey", "createdAt");

-- CreateIndex
CREATE INDEX "board_session_courseId_createdAt_idx" ON "board_session"("courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "board_session_event_sessionId_eventId_key" ON "board_session_event"("sessionId", "eventId");

-- AddForeignKey
ALTER TABLE "board_session" ADD CONSTRAINT "board_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_session" ADD CONSTRAINT "board_session_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_session" ADD CONSTRAINT "board_session_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_session_event" ADD CONSTRAINT "board_session_event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "board_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

