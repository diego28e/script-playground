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
- **Learners** (`components/courses/lesson-videos.tsx`): one video plays alone. Several get a small stepper **above**
  the player, kept apart from the lesson's own previous / next at the bottom of the page: a numbered dot per video,
  joined by lines that fill as videos are watched, a tick on each watched one, and on the current one a thin ring
  that fills as it plays. Titles show on hover in the platform's tooltip (a lesson can have seven videos), the current
  title once, left of the stepper, and "Next" rises in when a video ends. Arrow keys move between the dots.
  The open video is kept in the address (`?video=2`). A learner's state is kept per video (`LessonProgress.videoState`,
  by video id: where to resume, quiz answers, when finished); the migration re-keyed existing states by their video.
  A video lesson completes when all its videos have been watched to the end.

## Captions and posters

Decided with the admin on 2026-11-08: videos carry no captions in the picture; every video gets **English captions and
Spanish subtitles** as tracks, and each learner picks one in the player (lk-react's Captions menu: Off, English,
Español, or a second language under the first), or turns them off.

- **Made for you** (`lib/captions.ts`, `actions/video-media.ts`): **Deepgram Nova-3** transcribes the video's
  narration, sent as bytes: the encode's audio-only copy (`video-audio.mp4`, about 3 MB for 7 minutes; 2 to 3 s every
  time), or the video itself for one encoded before that copy existed. Deepgram fetching a file by its URL sometimes
  hung past 40 s for the same file that took 7 s a moment later, so the address is only used for a video over 200 MB.
  It returns word timings and smart formatting (numbers as digits), and the words become
  cues of at most two lines of about 42 characters and 7 seconds, ending at a sentence or a comma where possible.
  The authoring models (Claude Sonnet first) translate the cues to Latin American Spanish **line for line**, so both
  tracks share the same timings; code, product names and the technical terms developers say in English stay as they
  are. Both are written as WebVTT under the video's folder (`courses/<course>/<lesson>/<video id>/captions-<version>.<lang>.vtt`,
  new keys each time, since media files are cached for good) and replace the video's English and Spanish tracks.
  Each step is one request, because Amplify stops a request after about 30 s: the admin page runs them in turn
  (transcribe, translate in batches of 24 lines, three at a time, then save). Tried on 00.07's first video (6:54): the
  transcript differed from the script only in formatting; a 20-line video took about 9 s in all. A model name the
  narration spells out ("GPT six Luna" for GPT-6 Luna) is written as heard: Deepgram's key terms are the course's
  general ones, not each lesson's.
- **When:** automatically when an upload finishes encoding without caption files of its own (the admin page that
  follows the encode starts it), and from a video's **Captions** button at any time (with a confirmation when it
  already has tracks). Uploading your own WebVTT files with a video still works and skips the automatic captions.
- **Posters:** when uploading, the frame on screen or **Upload an image** (PNG, JPEG or WebP, made a JPEG of at most
  1920 px); for a video already on the lesson, its **Poster** button does the same, the frame taken from the stored
  video (the media host's CORS allows it). A new poster gets a new key in the video's folder.
- **Keys:** `DEEPGRAM_API_KEY` (the platform's voice key) and the authoring models' keys must be on the server.

## The player

A video with quizzes plays in lk-react's interactive player. Every other lesson video plays in the platform's own
player (`components/courses/video-player/`), drawn after the OCW platform's reviewer player and made for learners:

- **Its own controls, never the browser's:** no download item or native menu, the same look in every browser, and
  right-click on the video does nothing. A determined learner can still find the file (its signed address is in the
  page and expires in hours); this removes the easy ways.
- **Captions drawn by the player**, above its bar, in the learner's choice from the Captions menu (Off, English,
  Español); until they choose, the page's language. The `<track>` elements only make the browser parse the WebVTT.
- **Speed** from 0.5× to 2× (the button shows it when it isn't 1×), volume, ±10 s, time elapsed or remaining,
  picture in picture and fullscreen.
- **Transcript** under the video: the line being spoken is marked and followed, any line jumps there, and a search
  finds where something was said. The seek bar shows the line spoken under the pointer.
- **Keyboard:** Space/K, J/L, arrows, 0–9, < >, M, C, T, P, F, and ? for the list.
- Speed, volume, the caption language and the transcript are remembered in the browser for every lesson video.
- The bar hides while playing and comes back with the pointer, a tap or keyboard focus; the big play button shows
  only before the first play and after the end, so a paused frame (code to read) stays clear. On a phone the bar keeps
  play, volume, time, transcript, speed, captions and fullscreen.
