# Lesson audio

Every lesson can have an audio version: a teacher explaining the whole lesson out loud, for listening away from the
screen or alongside the page. It isn't the page read aloud. A model reads the lesson and writes what a good teacher
would say: every idea, step and example, explained, with an example or an analogy where a listener needs more, and the
code, tables and diagrams told in words. ElevenLabs' Eleven v4 voices it (Deepgram's Aura-2 is the cheaper option),
after a second pass marks the teacher's delivery: tone and pauses.

## How it flows

Each lesson has at most one `LessonAudio` row (`prisma/schema.prisma`), which moves through:

```
SCRIPT_QUEUED → WRITING → REVIEW → VOICE_QUEUED → VOICING → DONE
                                ↘ (a run "voiced without review" skips REVIEW)
any step that fails three times → FAILED
```

- The admin page queues work (`actions/lesson-audio.ts`, `lib/lesson-audio/queue.ts`).
- The **practice worker** on the lab server does it (`runAudioTick`, beside the practice jobs). There's no request time
  limit there, which a script needs: a long lesson takes a few minutes to write and up to ten to voice.
- A lesson asked for on its own goes before a whole-course run (`priority`), so a test never waits behind a course.
- A step that fails is retried after 1 and then 5 minutes; after three attempts the lesson is `FAILED`, with the reason.
  A worker that stops mid-step puts the lesson back in the queue when it starts again.
- **Learners hear `audioPath` whenever it's set.** Writing a script again, or voicing it again, replaces the audio only
  when the new one is ready.
- **Recording again**: one lesson from its dialog ("Voice again", with any voice), or every lesson read by another voice
  at once ("Record N again with …", `queueRevoice`), from the script each was voiced from.

## The script (`lib/lesson-audio/script.ts`)

- Read from the lesson's text (`lib/lesson-text.ts`): a reading's body, or its notebook from the course repository.
- **Written part by part.** Lessons run to 70,000 characters, more than a model writes well in one answer. The lesson
  is cut at its `##` sections into parts of about 9,000 characters (lesson 00.04, 13,000 characters, was two parts); each part is written with the lesson's outline, its
  place in it, and the last paragraphs of the part before, so it reads as one lesson. The first part opens the lesson
  (and links it to the previous one), the last closes it (the ideas to keep, the next lesson).
- **The rules** (`NARRATION_SYSTEM_PROMPT`): teach everything, explain the reasons, expand where a listener needs it,
  never invent facts, numbers or stories, keep a case's "real" or "invented" label, invite the learner to pause at the
  exercises, signpost, and leave a sources section unread. And write for a voice: plain text, short paragraphs, full
  punctuation, symbols and IP ranges as words, acronyms as people say them.
- **Length**: about 0.85 words of script per word of lesson in each part; a guide, not a quota.
- A part that comes back cut off is written again; the models sometimes leave out the end marker on a complete answer,
  so a part that ends on a finished sentence counts.

### The model

Chosen in the admin page; the others follow as fallbacks. Compared on lesson 03.10 of the SRE course (2026-11-19):

| Model (DolphinGo) | What it wrote | Time a part | Cost a lesson |
|---|---|---|---|
| **Qwen4-Max** (default) | The most teacher-like: analogies, pauses, acronyms and IP ranges already written for the voice | ~30 s | ~US$0.08 |
| DeepSeek V4.1 Flash | As faithful to the lesson; read tables out as lists | ~13 s | ~US$0.01 |
| Qwen3.8 Flash | Looser with the facts | ~20 s | ~US$0.01 |

Claude Sonnet 5.5 is the last fallback. The voice costs far more than any script, so the default is the best writer.

## The delivery (`lib/lesson-audio/delivery.ts`)

Before Eleven v4 reads an approved script, the script model directs the performance, the way ElevenLabs' own "Enhance"
button does (its prompt is in "Prompting Eleven v4",
elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), tuned for a teacher:

- **Audio tags** in square brackets for tone and pace (`[warmly]`, `[curious]`, `[serious]`, `[lightly amused]`,
  `[slower, deliberate]`), pauses (`[short pause]`, `[long pause]` after a question to the learner) and the odd human
  reaction (`[soft chuckle]`). About one every two or three sentences: v4 gets unstable when every sentence is directed.
- **Emphasis** without changing words: capitals on one key word of a paragraph at most, ellipses for a thoughtful pause.
- **Never**: whispering, shouting, accents, sound effects, SSML. v4 takes no `<break>` tags; pauses come from tags and
  ellipses.
- **Not a word changes, and that is checked**: the directed piece's words (tags, punctuation and capitals taken out)
  must equal the approved piece's, or the approved piece is voiced as it is.
- You review the plain script. What the voice read, with its tags, is kept (`audioDirected`) and shown in the lesson's
  dialog ("What the voice read"). Learners' transcript is the plain script.
- On lesson 00.04 (Qwen4-Max): about 11 s a piece, every word kept, tags adding about 5% to the characters voiced.
- "Teacher's delivery" can be turned off, in the toolbar or per lesson. Deepgram reads the plain script.

## The voice (`lib/lesson-audio/voice.ts`)

### ElevenLabs Eleven v4 (the default)

- `eleven_v4` on the Text to Speech API: the most emotive model, 10,000 characters a request, US$0.08 per 1,000
  characters (elevenlabs.io/pricing/api, 2026-11-19; tags count as characters). A 30,000-character script costs about
  US$2.50.
- Pieces of about 3,300 characters of whole paragraphs, voiced **one after another with request stitching**: each
  request names the three before it (`previous_request_ids`), so tone and pace carry across the lesson.
- Settings: stability 0.5, similarity 0.75 (the docs' defaults; v4 has no style or speed setting). MP3 at 44.1 kHz,
  96 kb/s. `language_code` is the course's language: v4 speaks each language natively with any voice.
- The voices are the six chosen in `NARRATION_VOICES`; their names and descriptions are read from ElevenLabs when Admin
  → Audio loads (`ELEVENLABS_API_KEY` on the platform). "Hear it" plays a sample with a teacher's delivery (about two
  cents).
- A busy (429) or failing (5xx) request is retried after 15 and 30 s; a refused one (key, quota, voice) fails the step.

### Deepgram Aura-2

- US$0.030 per 1,000 characters (deepgram.com/pricing, 2026-11-19), plainer. 2,000 characters a request, so pieces of
  whole paragraphs as MP3 (48 kb/s), three at a time; about four times faster than they play. Lesson 00.04 (14,360
  characters): 16 minutes of audio for US$0.43, voiced in under 4 minutes.

### Both

- **One file.** Each piece's ID3 tag and Xing/Info frame are taken out and the frames joined, so the file is plain
  constant-bit-rate MP3 whose length every player reads right; the length is also counted from the frames and stored.
- About 14 characters a second of speech (measured on Aura-2).
- Each voicing is written to the AI ledger (`ai_request`, model `elevenlabs-v4-narration` or
  `deepgram-aura-2-narration`) with its list cost; the delivery's model calls are logged like any other.

## Storing the file

The worker holds no AWS credentials. It asks the platform for an address to PUT the file to
(`app/api/lab-worker/audio-upload/route.ts`), signing the request with `LAB_WORKER_SECRET` (an HMAC of the time and the
body, refused after five minutes). The platform names the file from the database,
`courses/<course>/<lesson>/audio/<audio id>-<revision>.mp3`, so a signed request can only ever write a lesson's audio,
and a new revision never meets an old one in a cache. Learners' pages sign the `/media/` path like a video's
(`lib/media.ts`).

## For learners (`components/courses/lesson-audio.tsx`)

On the lesson page, under its title, when the lesson has audio: a bar like the video player's (it shares its speed
setting), with 15 s back and 30 s forward, the transcript (the script that was voiced), and where the learner stopped,
kept per browser. Nothing downloads until play. While it plays and the bar is scrolled away, a small bar follows at the
bottom of the screen. The phone's lock screen controls it (the Media Session API). A private course's audio is only on
pages its learners can open (`docs/private-courses.md`).

## Using it (Admin → Audio)

1. Choose the course, the model and the voice ("Hear it" first), and keep "Teacher's delivery" on for ElevenLabs.
2. **One lesson**: "Write script" on its row. It's written first, in a few minutes, and waits. "Review" opens it: read
   it, edit anything, choose the voice, "Approve and voice". Listen on the same dialog when it's done.
3. **The whole course**: "Write the N missing scripts". With "Voice them too, without review", each goes straight to
   the voice; without it, they wait, and "Approve and voice all" voices them when you're happy. Both say the cost first.
4. **Record again**: with a voice chosen, "Record N again with …" voices every lesson another voice read; one lesson's
   dialog has "Voice again". Each says the cost first, and learners hear the old audio until the new one is ready.
5. "Stop the queue" puts back what hasn't started; what's in progress finishes. "Retry" on a failed lesson queues the
   step that failed. "Take off the lesson" removes the audio and keeps the script.

## Setting it up

- **Platform (Amplify)**: `LAB_WORKER_SECRET`, a long random value, and `ELEVENLABS_API_KEY` (for the voices' names and
  "Hear it"). The media bucket's settings are the videos'.
- **Worker (`infra/lab/practice-worker/.env`)**: `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`, `DOLPHINGO_API_KEY`,
  `PLATFORM_URL` (the platform's address, `https://academiadelcodigo.com`) and the same `LAB_WORKER_SECRET`. Its start line in `docker logs
  practice-worker` says which of these it has (`audio`).
- **On a PC**: run the worker with `pnpm practice-worker:dev` and the dev server, with `PLATFORM_URL=http://localhost:3000`
  and a `LAB_WORKER_SECRET` of your own in both.
