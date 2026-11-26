-- AlterTable
ALTER TABLE "board_session_event" ADD COLUMN     "result" JSONB;

-- CreateTable
CREATE TABLE "learner_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learner_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learner_preference_userId_scope_createdAt_idx" ON "learner_preference"("userId", "scope", "createdAt");

-- AddForeignKey
ALTER TABLE "learner_preference" ADD CONSTRAINT "learner_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

