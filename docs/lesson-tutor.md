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
  sentences at a time. The orb says "Thinking" until the teacher is heard. **Speaking over the teacher cuts it off**
  (`docs/voice.md`, "Interrupting by voice"), and so does tapping the orb.
- **Then it listens again**, for a follow-up.
- **The conversation is kept** (`docs/voice-context.md`): reopening the sheet within 6 hours continues it; the header
  has **New conversation** and **Earlier conversations**, a list where each one can be opened, deleted, or used to jump
  the lesson to the moment it was asked at.
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
  lesson in the service. An interview-challenge lesson (`lib/lesson-sections.ts`) comes in parts within the same
  limit: the problem and its follow-up questions whole, then what fits of the reference solution and the model
  answers. So the teacher may tell a learner the solution before they try the challenge, by choice (2026-11-26).
- **Where the learner stopped**: the last 260 words the teacher had said and the next 80, found from the transcript's
  word timings (or their estimate), with the time ("1:10 / 15:02").
- **How to answer, as the teacher**: what the recording had just said and was about to say is context for the
  question, never a reason to hold anything back. Anything in the lesson, the course or the field around it gets a full
  answer; only a question unrelated to the course gets a short one. Never invent facts. In the learner's platform
  language.
- **What it knows about the learner** (`docs/voice-context.md`, "The learner profile"): how they like to learn and what
  they know in this course, from their earlier conversations.

## How it teaches (`lib/voice/teaching.ts`)

Shared with the practice coach (`docs/practice.md`, "Widgets"). **The learner leads**: they decide what to talk about
and how deep to go; the teacher decides how to explain it well. Rewritten on 2026-11-23, after the second version
proved slow, shallow and imposed (below).

- **Whatever they ask is answered now, fully.** Never "we'll get to that", "the lesson covers that later" or "for now
  just know". The lesson is material, not a script; a question about what the recording reaches later is answered
  anyway. A learner who would rather build the idea in conversation, or argue it out, than listen, can.
- **The answer first**, in the first sentence: no preamble, no "great question", no recap of the question.
- **Debate is welcome.** Pushed back on, the teacher takes a clear position with the reason and the evidence, and says
  so plainly when the learner is right.
- **Practical and deep where it matters:** a concrete example, the exact command, code or configuration, what you would
  see and what it means. When a concept is to be understood properly, the reply covers what's needed of what it is
  (and the problem it solves), how it works, why it is that way, how it's done for real, and what goes wrong, in the
  same reply, not dripped over several. A question holding several big ideas takes the one the others depend on first
  and names the rest.
- **As long as the answer needs.** A quick fact in one to three sentences; a concept usually 80 to 180 words; a
  procedure or "explain it properly" longer. No filler, no summary at the end of a short answer.
- **Checking understanding is the teacher's judgement, not a rule.** It reads what the learner says every turn and
  checks only when worth it (after something hard or easy to get wrong, before building on it, after a passive
  stretch), in varied ways: predict what happens, apply it to a new case, find the mistake, say it back. Never a
  question at the end of every reply; if the learner ignores a question and asks something else, it follows them. A
  partly wrong answer is still corrected plainly.
- **The learner's words steer:** "next" or "go on" continues, "again" gets another explanation and example, "deeper"
  adds detail, "shorter" shortens from then on.

The history, since each rule replaced one that hurt: the first version gave several concepts a sentence each. The
second took every concept through five fixed steps, one or two a reply, and ended every reply with a check question;
with the recording's next words in its context, it also put questions off ("you'll learn that later in the lesson").
The learner found it slow, shallow, and imposed.
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
   - `POST /v1/lesson/listen`: a grant for the microphone stream (recorded, not limited).
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

Per learner per day: **300 questions** (`TURNS_PER_DAY`, counted in `ai_request` as feature `lesson-tutor`; raised from
80 on 2026-11-21, since "next" is a question and a long session is a few hundred). Reading
aloud and the microphone have **no daily limit of ours** on Deepgram (removed 2026-11-21; Deepgram's account is the only
limit). One exception: when an admin sets the tutor to answer in a lesson's own ElevenLabs voice, that voice is rationed
to **25,000 characters in 24 hours** (`ELEVEN_SPEAK_CHARS_PER_DAY`, at most about US$2.60 of that account's credits). Every
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
