# The lesson tutor

While listening to a lesson's audio (`docs/lesson-audio.md`), often on a phone and away from a screen, a learner can stop
and ask the teacher about what they just heard, out loud. The teacher answers about the lesson, starting from what it had
just said when they stopped, in the lesson's own voice, then listens for the next question, until they go back to the
lesson.

## What the learner sees (`components/courses/lesson-tutor.tsx`)

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
- **How to answer, as the teacher**: spoken, not written (no Markdown, code only in words); the direct answer first,
  then why, building on what had just been said, then something concrete: an example, an analogy, or a real scenario
  from work. Correct a misunderstanding kindly. Sometimes end with a short question that checks understanding or asks
  them to apply it. About 100 to 180 words, up to 350 when asked to go deeper. Stay with the lesson; never invent
  facts. In the learner's platform language.

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

**The voice** (`lib/lesson-tutor/speak.ts`) is the one the lesson's audio was voiced in: an ElevenLabs voice through
**Flash v2.5** (its quickest model; half the credits of v4), a Deepgram voice through Aura-2. Phones only let a page
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
