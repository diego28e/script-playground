-- When each word of a lesson's audio is said, so its transcript follows the audio (docs/lesson-audio.md).
ALTER TABLE "lesson_audio" ADD COLUMN "timings" JSONB;
ALTER TABLE "lesson_audio" ADD COLUMN "timingTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lesson_audio" ADD COLUMN "timingError" TEXT;
