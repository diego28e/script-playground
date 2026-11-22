-- AlterTable
ALTER TABLE "lesson" ADD COLUMN "contentHash" TEXT,
ADD COLUMN "contentChangedAt" TIMESTAMP(3),
ADD COLUMN "missingSince" TIMESTAMP(3);
