-- Lesson audio (docs/lesson-audio.md): a teacher's narration of each lesson, written by a model and voiced by Deepgram.

-- CreateEnum
CREATE TYPE "LessonAudioStatus" AS ENUM ('SCRIPT_QUEUED', 'WRITING', 'REVIEW', 'VOICE_QUEUED', 'VOICING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "lesson_audio" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" "LessonAudioStatus" NOT NULL DEFAULT 'SCRIPT_QUEUED',
    "model" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "autoVoice" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notBefore" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "progress" TEXT,
    "error" TEXT,
    "script" TEXT,
    "scriptModel" TEXT,
    "scriptWords" INTEGER,
    "scriptedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "audioPath" TEXT,
    "audioSeconds" DOUBLE PRECISION,
    "audioScript" TEXT,
    "audioChars" INTEGER,
    "audioVoice" TEXT,
    "voicedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_audio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_audio_lessonId_key" ON "lesson_audio"("lessonId");

-- CreateIndex
CREATE INDEX "lesson_audio_status_priority_queuedAt_idx" ON "lesson_audio"("status", "priority", "queuedAt");

-- AddForeignKey
ALTER TABLE "lesson_audio" ADD CONSTRAINT "lesson_audio_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

