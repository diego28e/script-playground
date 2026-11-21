-- Practice widgets per course (docs/practice.md, "Widgets"): the Python scratchbook (on, as before) and the voice coach
-- (off until an admin turns it on in Admin → Courses).

-- AlterTable
ALTER TABLE "course" ADD COLUMN     "practiceScratchbook" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "practiceVoice" BOOLEAN NOT NULL DEFAULT false;
