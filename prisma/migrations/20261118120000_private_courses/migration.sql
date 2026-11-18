-- Private courses (docs/private-courses.md): a course is open to everyone, or only to the emails on its access list.
-- Every existing course stays public.

-- CreateEnum
CREATE TYPE "CourseVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "course" ADD COLUMN "visibility" "CourseVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "course_access" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_access_email_idx" ON "course_access"("email");

-- CreateIndex
CREATE UNIQUE INDEX "course_access_courseId_email_key" ON "course_access"("courseId", "email");

-- AddForeignKey
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
