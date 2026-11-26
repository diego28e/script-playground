-- AlterTable
ALTER TABLE "course" ADD COLUMN "lessonStops" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "lesson_stop" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "media" TEXT NOT NULL,
    "at" DOUBLE PRECISION NOT NULL,
    "titleEs" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "stepEs" TEXT NOT NULL,
    "stepEn" TEXT NOT NULL,
    "commands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_stop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_stop_lessonId_media_at_idx" ON "lesson_stop"("lessonId", "media", "at");

-- AddForeignKey
ALTER TABLE "lesson_stop" ADD CONSTRAINT "lesson_stop_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
