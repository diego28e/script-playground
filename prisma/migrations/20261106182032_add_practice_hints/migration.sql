-- AlterTable
ALTER TABLE "practice_task" ADD COLUMN     "editedFromId" TEXT;

-- CreateTable
CREATE TABLE "practice_hint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_hint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_hint_sessionId_taskId_number_key" ON "practice_hint"("sessionId", "taskId", "number");

-- AddForeignKey
ALTER TABLE "practice_hint" ADD CONSTRAINT "practice_hint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_hint" ADD CONSTRAINT "practice_hint_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "practice_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
