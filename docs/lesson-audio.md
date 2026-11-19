# Lesson audio

Every lesson can have an audio version: a teacher explaining the whole lesson out loud, for listening away from the
screen or alongside the page. It isn't the page read aloud. A model reads the lesson and writes what a good teacher
would say: every idea, step and example, explained, with an example or an analogy where a listener needs more, and the
code, tables and diagrams told in words. Deepgram voices it.

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

## The script (`lib/lesson-audio/script.ts`)

- Read from the lesson's text (`lib/lesson-text.ts`): a reading's body, or its notebook from the course repository.
- **Written part by part.** Lessons run to 70,000 characters, more than a model writes well in one answer. The lesson
  is cut at its `##` sections into parts of about 9,000 characters (lesson 00.04, 13,000 characters, was two parts); each part is written with the lesson's outline, its
  place in it, and the last paragraphs of the part before, so it reads as one lesson. The first part opens the lesson
  (and links it to the previous one), the last closes it (the ideas to keep, the next lesson).
- **The rules** (`NARRATION_SYSTEM_PROMPT`): teach everything, explain the reasons, expand where a listener needs it,
  never invent facts, numbers or stories, keep a case's "real" or "invented" label, invite the learner to pause at the
  exercises, signpost, and leave a sources section unread. And write for the voice, following Deepgram's advice for Aura-2: plain text, short paragraphs,
  full punctuation, symbols and IP ranges as words, acronyms as people say them.
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

## The voice (`lib/lesson-audio/voice.ts`)

- **Deepgram Aura-2**, US$0.030 per 1,000 characters (deepgram.com/pricing, 2026-11-19). Flux TTS costs US$0.045 and is
  made for live voice agents, not recorded narration.
- Aura-2 takes 2,000 characters a request, so the script is voiced in pieces of whole paragraphs (whole sentences of a
  long one), as MP3 (48 kb/s, mono), three at a time. Deepgram makes speech about four times faster than it plays:
  lesson 00.04 (14,360 characters, nine pieces) took under 4 minutes; a long lesson takes up to about 10.
- **One file.** Each piece's ID3 tag and Xing/Info frame are taken out and the frames joined, so the file is plain
  constant-bit-rate MP3 whose length every player reads right; the length is also counted from the frames and stored.
- Aura-2 speaks about 14 characters a second: a 30,000-character script plays for about 36 minutes and costs about
  US$0.90. Lesson 00.04 of the SRE course: a 2,500-word script, 16 minutes of audio, US$0.02 to write and US$0.43 to
  voice.
- The voices offered are the Aura-2 ones described for informative or storytelling use, and four Spanish voices that
  say English terms in English. "Hear it" plays a sample (about half a cent).
- Each voicing is written to the AI ledger (`ai_request`, model `deepgram-aura-2-narration`) with its cost.

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

1. Choose the course, the model and the voice ("Hear it" first).
2. **One lesson**: "Write script" on its row. It's written first, in a few minutes, and waits. "Review" opens it: read
   it, edit anything, choose the voice, "Approve and voice". Listen on the same dialog when it's done.
3. **The whole course**: "Write the N missing scripts". With "Voice them too, without review", each goes straight to
   the voice; without it, they wait, and "Approve and voice all" voices them when you're happy. Both say the cost first.
4. "Stop the queue" puts back what hasn't started; what's in progress finishes. "Retry" on a failed lesson queues the
   step that failed. "Take off the lesson" removes the audio and keeps the script.

## Setting it up

- **Platform (Amplify)**: `LAB_WORKER_SECRET`, a long random value. The media bucket's settings are the videos'.
- **Worker (`infra/lab/practice-worker/.env`)**: `DEEPGRAM_API_KEY`, `DOLPHINGO_API_KEY`, `PLATFORM_URL` (the platform's
  address, `https://academiadelcodigo.com`) and the same `LAB_WORKER_SECRET`. Its start line in `docker logs
  practice-worker` says which of these it has (`audio`).
- **On a PC**: run the worker with `pnpm practice-worker:dev` and the dev server, with `PLATFORM_URL=http://localhost:3000`
  and a `LAB_WORKER_SECRET` of your own in both.
