-- CreateEnum
CREATE TYPE "FoundSkillOrigin" AS ENUM ('DIAGNOSIS', 'TUTOR');

-- AlterEnum
ALTER TYPE "PracticeEvidence" ADD VALUE 'REQUESTED';

-- AlterTable
ALTER TABLE "practice_found_skill" ADD COLUMN     "context" TEXT,
ADD COLUMN     "origin" "FoundSkillOrigin" NOT NULL DEFAULT 'DIAGNOSIS';

-- AlterTable
ALTER TABLE "practice_request" ADD COLUMN     "detail" JSONB,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolveTries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedKey" TEXT;
