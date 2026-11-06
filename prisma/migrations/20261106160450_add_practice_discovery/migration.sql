-- CreateEnum
CREATE TYPE "PracticeDiagnosisStatus" AS ENUM ('PENDING', 'RUNNING', 'OPENED', 'NONE', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscoveredEdgeStatus" AS ENUM ('PROPOSED', 'ADDED', 'DISMISSED');

-- AlterTable
ALTER TABLE "practice_learner" ADD COLUMN     "extensions" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "practice_diagnosis" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "skillKey" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" "PracticeDiagnosisStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "proposals" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "practice_diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_found_skill" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labelEs" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "descriptionEs" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "knowledge" "SkillKnowledge" NOT NULL,
    "runnable" BOOLEAN NOT NULL DEFAULT true,
    "node" JSONB NOT NULL,
    "lessonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_found_skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_discovered_edge" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "fromKey" TEXT NOT NULL,
    "toKey" TEXT NOT NULL,
    "status" "DiscoveredEdgeStatus" NOT NULL DEFAULT 'PROPOSED',
    "rationale" TEXT,
    "opened" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "refuted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_discovered_edge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_diagnosis_evidenceId_key" ON "practice_diagnosis"("evidenceId");

-- CreateIndex
CREATE INDEX "practice_diagnosis_learnerId_createdAt_idx" ON "practice_diagnosis"("learnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "practice_found_skill_courseId_key_key" ON "practice_found_skill"("courseId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "practice_discovered_edge_courseId_fromKey_toKey_key" ON "practice_discovered_edge"("courseId", "fromKey", "toKey");

-- AddForeignKey
ALTER TABLE "practice_diagnosis" ADD CONSTRAINT "practice_diagnosis_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "practice_learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_found_skill" ADD CONSTRAINT "practice_found_skill_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_discovered_edge" ADD CONSTRAINT "practice_discovered_edge_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
