-- CreateEnum
CREATE TYPE "VideoUploadStatus" AS ENUM ('UPLOADING', 'ENCODING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "video_upload" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" "VideoUploadStatus" NOT NULL DEFAULT 'UPLOADING',
    "fileName" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "outputPrefix" TEXT NOT NULL,
    "posterKey" TEXT,
    "captions" JSONB NOT NULL DEFAULT '[]',
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "jobId" TEXT,
    "percent" INTEGER,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_upload_lessonId_createdAt_idx" ON "video_upload"("lessonId", "createdAt");

-- AddForeignKey
ALTER TABLE "video_upload" ADD CONSTRAINT "video_upload_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
