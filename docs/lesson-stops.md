# Hands-on stops

A lesson's audio or video can pause where the learner has something to do on their own: run a command, install
something, create or edit a file, check an output, or a short exercise the recording asks for now ("write four lines",
"tell it out loud"). Listening, it's easy to miss that a step was meant to be done; the player stops there and shows the
step, with its exact commands to copy, until the learner continues.

## How it works

- **One row per stop** (`LessonStop`, `prisma/schema.prisma`): the lesson, which recording (`media`: `"audio"`, or
  `"video:<LessonVideoPart id>"`), the second it pauses at (`at`), a title and a step in Spanish and English, the
  commands, and who wrote it (the model's id, or `admin` once edited by hand).
- **Per course switch** (`Course.lessonStops`, off by default). Learners see a course's stops only when it's on
  (`lib/lesson-stops/read.ts`), so stops can be written and reviewed first.
- **Plain videos and lesson audio.** An interactive video (one with questions) plays in lk-react's own player, which
  already stops at its questions; stops aren't offered for it.

## Writing them (`lib/lesson-stops/generate.ts`)

A model reads the recording's timed transcript and the lesson's text, and marks where an instruction is finished:

- **The transcript, timed.** The audio's script with the worker's word timings (`docs/lesson-audio.md`, "Following the
  audio"), or an even pace until those exist. A video's English captions (WebVTT) from the media bucket, each cue's
  words spread over the cue. The words are cut into sentences, numbered, each with its time.
- **In windows, at once.** 110 sentences per request (about 15 minutes of speech), every window in parallel, so a long
  lesson fits a request's time (`REQUEST_BUDGET_MS`). The lesson's text (up to 14,000 characters) goes with each.
- **Checked.** A stop pointing at a sentence outside its window is dropped. A command is kept only if it appears,
  character for character, in the lesson's text or the transcript: the model can't invent one. Stops closer than 20 s
  become one. The admin page says how many suggestions the checks dropped.
- **Where it pauses:** 0.1 s before the next sentence starts, so the instruction is heard whole.
- **Models** (`STOP_MODELS`): DeepSeek V4.1 Flash (the default), Qwen4-Max through DolphinGo (cheaper than
  Qwen3.8-Max, $1.413 and $4.24 per million tokens in and out), and DeepSeek V4.1 Flash through DolphinGo. Each goes
  through the authoring fallback chain (`authoringChain`), and calls are recorded as `lesson-stops` in AI usage.

Measured on 2026-11-25 on a 15-minute lesson (SRE 00.04, two windows): DeepSeek V4.1 Flash answered in 4.9 s and
Qwen4-Max in 11.7 s, about 6,000 tokens in and 800 out per window; both found the same exercises.

## Using it (Admin → Stops)

`/admin/stops` lists the chosen course's lessons that have audio or videos, by module.

1. Pick the model, then **Write stops for N recordings** (every recording without stops, one after another), or
   **Write stops** on one recording. **Write again** replaces what it had, after asking.
2. Open a recording to review its stops: the time (m:ss), title and step in both languages, and the commands, one per
   line. Save, delete, or add one by hand.
3. Turn on **Pause at hands-on steps** for the course.

A video needs captions first (Admin → Videos). An audio lesson voiced again keeps its stops; write them again if the
script changed much.

## For learners (`components/courses/lesson-stops.tsx`)

- When the playhead crosses a stop while playing, the player pauses and shows **Your turn**: the step, each command
  with a Copy button, **Done, continue**, and, in the audio player, **Ask the teacher** (`docs/lesson-tutor.md`).
- A stop continued doesn't stop again unless the learner goes back before it. Seeking past one doesn't stop either
  (only a crossing of up to 3 s while playing does).
- **The switch** (a raised hand on the player's bar, struck through when off) turns the pauses off or on, for every
  lesson, in that browser (`localStorage` `adc_lesson_stops`); the card has **Don't pause in lessons** too. For
  listening away from the computer.
- The audio player's seek bar shows each stop's title when the pointer is over its time.
