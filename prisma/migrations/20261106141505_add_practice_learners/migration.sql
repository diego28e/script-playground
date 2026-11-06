-- CreateTable
CREATE TABLE "practice_learner" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "graphVersion" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_learner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_log_entry" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "entry" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_session" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "extra" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "practice_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_answer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_learner_userId_courseId_key" ON "practice_learner"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_log_entry_learnerId_seq_key" ON "practice_log_entry"("learnerId", "seq");

-- CreateIndex
CREATE INDEX "practice_session_learnerId_day_idx" ON "practice_session"("learnerId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "practice_answer_sessionId_taskId_key" ON "practice_answer"("sessionId", "taskId");

-- AddForeignKey
ALTER TABLE "practice_learner" ADD CONSTRAINT "practice_learner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_learner" ADD CONSTRAINT "practice_learner_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_log_entry" ADD CONSTRAINT "practice_log_entry_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "practice_learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_session" ADD CONSTRAINT "practice_session_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "practice_learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_answer" ADD CONSTRAINT "practice_answer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_answer" ADD CONSTRAINT "practice_answer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "practice_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
