-- The language of a course's code practice (docs/practice.md, "Languages"): Python for every course so far, as
-- before; TypeScript is chosen in Admin → Courses. It picks the scratchbook's language and that of new code tasks.

-- AlterTable
ALTER TABLE "course" ADD COLUMN     "practiceLanguage" TEXT NOT NULL DEFAULT 'python';
