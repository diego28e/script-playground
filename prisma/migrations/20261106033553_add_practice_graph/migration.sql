-- CreateEnum
CREATE TYPE "SkillKnowledge" AS ENUM ('DECLARATIVE', 'PROCEDURAL');

-- CreateEnum
CREATE TYPE "SkillEdgeStrength" AS ENUM ('HARD', 'SOFT');

-- CreateEnum
CREATE TYPE "SkillDraftStatus" AS ENUM ('DRAFTED', 'APPROVED');

-- AlterEnum
ALTER TYPE "AiPool" ADD VALUE 'AUTHORING';

-- CreateTable
CREATE TABLE "practice_skill" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labelEs" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "descriptionEs" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "knowledge" "SkillKnowledge" NOT NULL,
    "runnable" BOOLEAN NOT NULL DEFAULT true,
    "criteriaHint" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_skill_edge" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "strength" "SkillEdgeStrength" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_skill_edge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_lesson_draft" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" "SkillDraftStatus" NOT NULL DEFAULT 'DRAFTED',
    "model" TEXT,
    "traceId" TEXT,
    "draftedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,

    CONSTRAINT "practice_lesson_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_graph_version" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "skillCount" INTEGER NOT NULL,
    "edgeCount" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,

    CONSTRAINT "skill_graph_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_skill_lessonId_position_idx" ON "practice_skill"("lessonId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "practice_skill_courseId_key_key" ON "practice_skill"("courseId", "key");

-- CreateIndex
CREATE INDEX "practice_skill_edge_toId_idx" ON "practice_skill_edge"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_skill_edge_fromId_toId_key" ON "practice_skill_edge"("fromId", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_lesson_draft_lessonId_key" ON "practice_lesson_draft"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_graph_version_courseId_version_key" ON "skill_graph_version"("courseId", "version");

-- AddForeignKey
ALTER TABLE "practice_skill" ADD CONSTRAINT "practice_skill_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_skill" ADD CONSTRAINT "practice_skill_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_skill_edge" ADD CONSTRAINT "practice_skill_edge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "practice_skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_skill_edge" ADD CONSTRAINT "practice_skill_edge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "practice_skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_lesson_draft" ADD CONSTRAINT "practice_lesson_draft_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_graph_version" ADD CONSTRAINT "skill_graph_version_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
