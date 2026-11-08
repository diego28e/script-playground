-- A lesson's videos (docs/lesson-videos.md): several per lesson, one per skill as a rule, instead of lesson.video.

-- CreateEnum
CREATE TYPE "LessonVideoSource" AS ENUM ('UPLOAD', 'REPOSITORY');

-- CreateTable
CREATE TABLE "lesson_video_part" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "skillKey" TEXT,
    "titleEs" TEXT,
    "titleEn" TEXT,
    "video" JSONB NOT NULL,
    "source" "LessonVideoSource" NOT NULL DEFAULT 'UPLOAD',
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lesson_video_part_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_video_part_lessonId_position_idx" ON "lesson_video_part"("lessonId", "position");

-- AddForeignKey
ALTER TABLE "lesson_video_part" ADD CONSTRAINT "lesson_video_part_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "video_upload" ADD COLUMN     "partId" TEXT,
ADD COLUMN     "skillKey" TEXT,
ADD COLUMN     "titleEn" TEXT,
ADD COLUMN     "titleEs" TEXT;

-- AddForeignKey
ALTER TABLE "video_upload" ADD CONSTRAINT "video_upload_partId_fkey" FOREIGN KEY ("partId") REFERENCES "lesson_video_part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each lesson's video becomes its first video: an upload's when the lesson has a finished upload (with its length),
-- the course repository's otherwise.
INSERT INTO "lesson_video_part" ("id", "lessonId", "position", "video", "source", "durationSeconds", "updatedAt")
SELECT
    'lvp_' || replace(gen_random_uuid()::text, '-', ''),
    l."id",
    0,
    l."video",
    CASE WHEN u."id" IS NULL THEN 'REPOSITORY'::"LessonVideoSource" ELSE 'UPLOAD'::"LessonVideoSource" END,
    u."durationSeconds",
    CURRENT_TIMESTAMP
FROM "lesson" l
LEFT JOIN LATERAL (
    SELECT v."id", v."durationSeconds" FROM "video_upload" v
    WHERE v."lessonId" = l."id" AND v."status" = 'READY'
    ORDER BY v."createdAt" DESC LIMIT 1
) u ON TRUE
WHERE l."video" IS NOT NULL;

-- That upload filled that video.
UPDATE "video_upload" v SET "partId" = p."id"
FROM "lesson_video_part" p
WHERE p."lessonId" = v."lessonId" AND p."source" = 'UPLOAD' AND v."status" = 'READY';

-- A learner's state for the lesson's video becomes their state for that video, keyed by its id.
UPDATE "lesson_progress" lp SET "videoState" = jsonb_build_object(p."id", lp."videoState")
FROM "lesson_video_part" p
WHERE p."lessonId" = lp."lessonId" AND lp."videoState" IS NOT NULL;
UPDATE "lesson_progress" lp SET "videoState" = NULL
WHERE lp."videoState" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "lesson_video_part" p WHERE p."lessonId" = lp."lessonId");

-- AlterTable
ALTER TABLE "lesson" DROP COLUMN "video";
