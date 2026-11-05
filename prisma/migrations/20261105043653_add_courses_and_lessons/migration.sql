-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "LessonKind" AS ENUM ('VIDEO', 'NOTEBOOK', 'READING', 'PRACTICE', 'PROJECT');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "course" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceRepoUrl" TEXT,
    "sourceRef" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_module" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "goals" TEXT,
    "estimatedTime" TEXT,
    "part" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "kind" "LessonKind" NOT NULL,
    "estimatedTime" TEXT,
    "estimatedMinutes" INTEGER,
    "prerequisites" TEXT,
    "objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourcePath" TEXT,
    "body" TEXT,
    "video" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_slug_key" ON "course"("slug");

-- CreateIndex
CREATE INDEX "course_module_courseId_position_idx" ON "course_module"("courseId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "course_module_courseId_slug_key" ON "course_module"("courseId", "slug");

-- CreateIndex
CREATE INDEX "lesson_moduleId_position_idx" ON "lesson"("moduleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_moduleId_slug_key" ON "lesson"("moduleId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_userId_courseId_key" ON "enrollment"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_userId_lessonId_key" ON "lesson_progress"("userId", "lessonId");

-- AddForeignKey
ALTER TABLE "course_module" ADD CONSTRAINT "course_module_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "course_module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
