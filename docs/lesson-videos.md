# Lesson videos

Each lesson can have several videos, in teaching order: as a rule **one short tutorial per skill** of the lesson (the
skills of the practice skill graph), so a lesson's videos are a small playlist that prepares learners for exactly what
practice will ask. Decided with the admin on 2026-11-07.

## How a video is made

The videos are made outside the platform, in the video studio (`09-ai-video-studio/videos/langchain-course`), by a
Claude session that follows the studio's `TEACHING-VIDEO-GUIDE.md` (the series' standing instructions: a calm senior
developer, voice only, line by line, English narration with Spanish subtitles, the platform's look) and the lesson's
**video brief**.

**The video brief** (`lib/video-brief.ts`; Admin → Videos → a lesson's **Video brief**, previewed before it's
downloaded) is everything the platform knows about one lesson, in one Markdown file:

- the lesson: objectives, prerequisites, time, and its place in the course (the lessons before and after);
- its skills, in teaching order, from `PracticeSkill`: what each is, procedural or declarative, what shows it was
  learned (`criteriaHint`, what practice checks), what it builds on and what uses it later, its Spanish label for the
  subtitles, and how learners have done in practice;
- where learners stumble, aggregated and never naming anyone: prerequisites practice found missing (diagnoses),
  what learners asked the tutor to practise (with the tutor's challenge), misconceptions and struggles the tutor noted
  in conversations about this lesson, and the hardest skills in practice;
- the notebook, from the course repository at the imported commit (saved without outputs: the video session runs the
  cells for real output), and the reference solution when the repository has one.

A video for each skill is then uploaded to the lesson, tied to its skill.

## How the platform holds them

`LessonVideoPart` (table `lesson_video_part`, migration `lesson_video_parts`): a lesson's videos, each with its
position, the skill it teaches (`skillKey`, a `PracticeSkill` key; its label is the title unless the video has its own
`titleEs`/`titleEn`), the video in lk-core's format (`lib/lesson-video.ts`: a plain media object, or an interactive item
group with its quizzes), where it came from (`UPLOAD` or `REPOSITORY`) and its length. It replaced the single
`Lesson.video`: the migration moved each lesson's video into its first part (an upload's when the lesson had a finished
upload, the repository's otherwise).

- **Uploads** (Admin → Videos, `actions/videos.ts`): **Add video** asks what the video teaches, one of the lesson's
  skills (those without a video first; one that has a video gets it replaced) or another video with its own title in
  both languages; each video in the list can be **replaced** (an interactive one keeps its quizzes), **moved** up or down,
  or **removed** (the files stay in the bucket). Encoding works as before (presigned upload, MediaConvert); when it
  finishes, the upload fills the video it was for, or a new video joins the end of the list.
- **The course import** (`scripts/import-course.ts`): a lesson's `NN-MM-slug.video.json` sidecar is its `REPOSITORY`
  video, kept first in the list and rewritten on every import; uploaded videos are never touched by an import.
- **Learners** (`components/courses/lesson-videos.tsx`): one video plays alone; several get a playlist under the player
  (the videos are landscape 1920 x 1080 screencasts, so the player keeps the column's full width), each with its length and a tick once watched to the end, a counter and the video's
  title under the player, and "Next" when one ends. The open video is kept in the address (`?video=2`). A learner's
  state is kept per video (`LessonProgress.videoState`, by video id: where to resume, quiz answers, when finished); the
  migration re-keyed existing states by their video. A video lesson completes when all its videos have been watched to
  the end.
