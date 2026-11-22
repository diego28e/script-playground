-- AlterTable
ALTER TABLE "voice_conversation" ADD COLUMN "profileSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "learner_profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "updates" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "learner_profile_userId_scope_key" ON "learner_profile"("userId", "scope");

-- AddForeignKey
ALTER TABLE "learner_profile" ADD CONSTRAINT "learner_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
