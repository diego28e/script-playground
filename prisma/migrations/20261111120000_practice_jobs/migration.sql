-- CreateEnum
CREATE TYPE "PracticeJobKind" AS ENUM ('WRITE_TASKS', 'DRAFT_LESSONS');

-- CreateEnum
CREATE TYPE "PracticeJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'STOPPING', 'STOPPED', 'DONE', 'HALTED');

-- CreateEnum
CREATE TYPE "PracticeJobItemStatus" AS ENUM ('PENDING', 'RUNNING', 'OK', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "practice_job" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "kind" "PracticeJobKind" NOT NULL,
    "status" "PracticeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "createdById" TEXT NOT NULL,
    "error" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "practice_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_job_item" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "skillKey" TEXT,
    "stage" TEXT,
    "lessonId" TEXT,
    "label" TEXT NOT NULL,
    "status" "PracticeJobItemStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notBefore" TIMESTAMP(3),
    "result" TEXT,
    "model" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "practice_job_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_job_status_createdAt_idx" ON "practice_job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "practice_job_courseId_createdAt_idx" ON "practice_job"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "practice_job_item_jobId_status_position_idx" ON "practice_job_item"("jobId", "status", "position");

-- AddForeignKey
ALTER TABLE "practice_job" ADD CONSTRAINT "practice_job_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_job_item" ADD CONSTRAINT "practice_job_item_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "practice_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

