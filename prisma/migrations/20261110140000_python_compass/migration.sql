-- CreateEnum
CREATE TYPE "CompassCardStatus" AS ENUM ('DRAFT', 'PROVEN', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CompassSignalKind" AS ENUM ('SEARCH', 'CARD_VIEW', 'EXPLAIN_LINE', 'RUN_ERROR', 'ASK', 'PRACTICE_MISS');

-- CreateTable
CREATE TABLE "compass_concept" (
    "id" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "labelEs" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "usageRank" INTEGER,
    "lessonCount" INTEGER NOT NULL DEFAULT 0,
    "firstLesson" TEXT,
    "demand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compass_concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compass_card" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CompassCardStatus" NOT NULL DEFAULT 'DRAFT',
    "pythonVersion" TEXT NOT NULL DEFAULT '3.12',
    "content" JSONB NOT NULL,
    "examples" JSONB NOT NULL,
    "docs" JSONB NOT NULL,
    "related" TEXT[],
    "proof" JSONB,
    "author" TEXT NOT NULL,
    "reviewedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compass_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compass_signal" (
    "id" TEXT NOT NULL,
    "kind" "CompassSignalKind" NOT NULL,
    "userId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'python',
    "conceptKey" TEXT,
    "text" TEXT,
    "empty" BOOLEAN NOT NULL DEFAULT false,
    "surface" TEXT,
    "courseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compass_signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compass_concept_language_usageRank_idx" ON "compass_concept"("language", "usageRank");

-- CreateIndex
CREATE UNIQUE INDEX "compass_concept_language_key_key" ON "compass_concept"("language", "key");

-- CreateIndex
CREATE INDEX "compass_card_status_idx" ON "compass_card"("status");

-- CreateIndex
CREATE UNIQUE INDEX "compass_card_conceptId_version_key" ON "compass_card"("conceptId", "version");

-- CreateIndex
CREATE INDEX "compass_signal_kind_createdAt_idx" ON "compass_signal"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "compass_signal_conceptKey_kind_idx" ON "compass_signal"("conceptKey", "kind");

-- AddForeignKey
ALTER TABLE "compass_card" ADD CONSTRAINT "compass_card_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "compass_concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

