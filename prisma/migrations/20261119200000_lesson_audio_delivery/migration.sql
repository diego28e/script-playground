-- Lesson audio delivery (docs/lesson-audio.md): emotion and pauses added for an expressive voice, and what the voice read.

-- AlterTable
ALTER TABLE "lesson_audio" ADD COLUMN     "audioDirected" TEXT,
ADD COLUMN     "delivery" BOOLEAN NOT NULL DEFAULT true;

