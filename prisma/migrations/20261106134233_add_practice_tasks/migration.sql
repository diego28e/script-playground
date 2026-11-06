-- CreateEnum
CREATE TYPE "PracticeTaskStatus" AS ENUM ('PROVEN', 'REJECTED', 'RETIRED');

-- CreateTable
CREATE TABLE "practice_task" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "skillKey" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedSeconds" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "item" JSONB,
    "status" "PracticeTaskStatus" NOT NULL,
    "rejectReason" TEXT,
    "model" TEXT NOT NULL,
    "traceId" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_task_courseId_skillKey_stage_status_idx" ON "practice_task"("courseId", "skillKey", "stage", "status");

-- CreateIndex
CREATE UNIQUE INDEX "practice_task_courseId_contentHash_key" ON "practice_task"("courseId", "contentHash");

-- AddForeignKey
ALTER TABLE "practice_task" ADD CONSTRAINT "practice_task_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
