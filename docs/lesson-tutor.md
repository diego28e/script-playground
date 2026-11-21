# The lesson tutor

While listening to a lesson's audio (`docs/lesson-audio.md`), often on a phone and away from a screen, a learner can stop
and ask the teacher about what they just heard, out loud. The teacher answers about the lesson, starting from what it had
just said when they stopped, in the lesson's own voice, then listens for the next question, until they go back to the
lesson.

## What the learner sees (`components/courses/lesson-tutor.tsx`)

The sheet itself (the orb, the listening, the replies shown and read aloud) is `components/voice/voice-tutor.tsx`,
shared with the practice coach (`docs/practice.md`, "Widgets"); the lesson tutor opens it with a pass for the lesson
and the moment the audio was paused at.

- **"Ask"** on the audio bar (and an icon on the small bar that follows the page) pauses the lesson and opens a sheet:
  from the bottom on a phone, a card at the bottom right on a computer.
- **The orb** (the lab tutor's voice orb, `lib/voice/orb.ts`) listens at once. The words appear as they're heard, and the
  question sends itself when the learner stops talking (Deepgram Flux, patient turn-taking, as in the lab:
  `docs/voice.md`).
- **The answer** appears as it's written and is read aloud as it comes: its first sentence at once, then a few
  sentences at a time. The orb says "Thinking" until the teacher is heard. Tapping the orb while it speaks cuts it off
  and listens.
- **Then it listens again**, for a follow-up. The conversation so far goes with each question.
- **Typing** works too (a noisy street, a quiet office), and so does the microphone switch. A speaker switch stops
  answers being read aloud, remembered per browser.
- **"Back to the lesson"** closes the sheet and plays the lesson from 3 seconds before where it stopped. The close
  button and Escape close it without playing.
- If the browser refuses the microphone, the sheet says so and the learner types.

## How the teacher answers (`lib/lesson-tutor/turn.ts`)

One model call a question, streamed: DeepSeek V4.1 Flash first (a spoken answer must start quickly; the free Gemini
models are often busy, and a hang there is seconds of silence; about a tenth of a cent a question), then the free
Gemini models. The model is told:

- **The lesson**: the course, its title and objectives, and its text (16,000 characters at most), kept 10 minutes per
  lesson in the service.
- **Where the learner stopped**: the last 260 words the teacher had said and the next 80, found from the transcript's
  word timings (or their estimate), with the time ("1:10 / 15:02").
- **How to answer, as the teacher**: the direct answer first, in a sentence or two, building on what had just been
  said; then it teaches it properly (below). Correct a misunderstanding kindly. 120 to 220 words a reply, plus any code.
  Stay with the lesson; never invent facts. In the learner's platform language.

## How it teaches (`lib/voice/teaching.ts`)

Shared with the practice coach (`docs/practice.md`, "Widgets"). The first version answered a question with several
concepts in a sentence each, which is easy to say and hard to learn from. Now:

- **One concept at a time.** A question that holds several is split: the teacher names them, starts with the one the
  others depend on, and says the rest come after.
- **Five steps per concept, in order:** what it is (and the problem it solves); how it works (the mechanism, where it
  lives); why it is that way (what breaks without it, the tradeoff); in practice (the procedure in production: the
  command to run, the file to edit and what goes in it, what you should see, how to check it worked); what goes wrong
  (the common mistakes and what each costs).
- **At the learner's pace.** One or two steps a reply, never more, then a short question that makes the learner use
  what was just said (never "does that make sense?"). It goes on when they answer or say "next"; "again" gets another
  explanation with a different example; "deeper" stays on the step. A partly wrong answer is corrected first, plainly.
- **Exact commands, files and settings**, in backticks (`terraform init -migrate-state`), shown on the sheet as code
  and read aloud when short (60 characters or fewer). A configuration of several lines goes in a code block, which is
  shown and not read: the teacher says in words what it does. Only what it is sure of, from the lesson when the lesson
  has it; otherwise it says it isn't sure and where to check. The way recommended today comes first, and an older,
  deprecated way is named as such.

Tried on 2026-11-20 (DeepSeek V4.1 Flash). On lesson 03.08, "What is a TTL, and how do I use it when moving a service?"
got what, how and why in 235 words with a check question; the answer to it got the procedure in six ordered steps and
the mistake that costs people; "next" got four mistakes with who notices each and how to recover. One flaw found and
fixed in the prompt: it said "exactly right" to "up to a day" for a 3,600-second TTL. One limit that a prompt doesn't
fix: off the lesson, on Terraform state locking, it called the DynamoDB lock table "the modern way", when S3's own
lockfile is the current one. Commands that matter should be in the lesson, where it takes them from.

## The voice's speed

Replies are read at **0.9** of the voice's own pace by default, and a button on the sheet steps through 0.8×, 0.85×,
0.9× and 1× (`lib/voice/speed.ts`), remembered per browser and sent with each piece to read. Every engine takes it:
Deepgram Flux TTS as `speed` (0.5 to 1.5 in steps of 0.05), Aura-2 the same way (0.7 to 1.5; its Spanish voices no
lower than 0.9, where Deepgram says they stumble), ElevenLabs Flash as `voice_settings.speed` (0.7 to 1.2). Measured
on Aura-2, one 35-word passage: 12.0 s at 1, 13.1 s at 0.9, 15.6 s at 0.8, 19.2 s at 0.7; tried by ear, 0.8 dragged.
Speed isn't billed. The lab's tutor panel, which sends no speed, gets the same default.

## How it's served

Amplify buffers a response until it's whole (no streaming from route handlers), and a spoken answer can't wait for the
whole reply to be written and then voiced. So the tutor runs on the lab's **learning service** (`services/learning`),
which already streams the lab tutor's replies and voice:

1. The page asks the platform for a **pass** (`actions/lesson-tutor.ts`): a signed-in learner who may see the lesson
   gets one for that lesson, valid 3 hours, signed with `LESSON_TUTOR_SECRET` (`lib/lesson-tutor/pass.ts`), with the
   service's address (`LESSON_TUTOR_URL`).
2. The browser calls the service directly, `Authorization: Pass <pass>`, through nginx on the lab's domain
   (`/learning/v1/lesson/…`, the only part of the service published):
   - `POST /v1/lesson/listen`: a grant for the microphone stream (counted like the lab's: 60 streams a day).
   - `POST /v1/lesson/turn`: the question; lines of JSON as the answer is written, then the result.
   - `POST /v1/lesson/speak`: a piece of the answer read aloud, raw PCM streamed as it's made.
3. The service trusts only the pass for who and which lesson, checks again that the learner may see it, and answers
   with CORS headers for the platform's origins only (`LESSON_TUTOR_ORIGINS`).

**The voice** (`lib/lesson-tutor/speak.ts`) is the explainers' voice, a Deepgram Flux voice chosen in Admin → Audio
(`docs/voice.md`, "The explainer's voice"). With "On lessons, answer in the lesson's own voice" turned on there, it is
the one the lesson's audio was voiced in instead: an ElevenLabs voice through **Flash v2.5** (its quickest model; half
the credits of v4), a Deepgram voice through Aura-2. Phones only let a page
make sound from the tap that asked for it, so "Ask" starts the page's audio context in its own handler
(`unlockSound`, `lib/voice/browser.ts`).

## Costs and limits

Per learner per day: **80 questions** (`TURNS_PER_DAY`, counted in `ai_request` as feature `lesson-tutor`) and
**25,000 characters read aloud** (about 35 long answers; at most about US$2.60 at this account's ElevenLabs rate). Every
call is in the spend ledger with its provider's id (`docs/voice-spend.md`): `lesson-tutor.speak` (ElevenLabs trace id
or Deepgram request id) and `lesson-tutor.listen` (Deepgram tag `adc-lesson-tutor-listen`).

Measured locally on 2026-11-20, a typed question on lesson 00.04: the answer's first words in about 3 s, the whole
answer from DeepSeek in 4.5 s (3,800 input tokens), read aloud in four ElevenLabs pieces.

## Setting it up

- **Platform (Amplify)**: `LESSON_TUTOR_URL` (`https://<lab domain>/learning`) and `LESSON_TUTOR_SECRET` (a long random
  value). Without both, the "Ask" button isn't shown.
- **Learning service (`infra/lab/learning/.env`)**: the same `LESSON_TUTOR_SECRET`, `ELEVENLABS_API_KEY`, and, if the
  platform is served from other addresses than `https://academiadelcodigo.com` and `https://www.academiadelcodigo.com`,
  `LESSON_TUTOR_ORIGINS` (comma-separated). It already has `DEEPGRAM_API_KEY` and the model keys.
- **The learning service's port** published on the server only (`127.0.0.1:8091`, `infra/lab/compose.yaml`), and the
  nginx location in `infra/lab/nginx/lab.conf` (on the running server, `/etc/nginx/snippets/lab-learning.conf`).
- **On a PC**: `pnpm learning:dev` with `PORT=8091`, `LESSON_TUTOR_SECRET` and `LESSON_TUTOR_ORIGINS=http://localhost:3000`,
  and the dev server with `LESSON_TUTOR_URL=http://localhost:8091` and the same secret.
