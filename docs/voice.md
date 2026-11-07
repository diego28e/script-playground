# Speaking with the AI (milestone 12)

Learners talk to the tutor instead of typing, hear its replies when they want, and explain a concept in their own words
as a practice task, by voice or in writing.

## Decisions (interview, 2026-11-06)

| Question | Decision |
|---|---|
| Where | The lab's tutor panel (also inside the lesson page's Notebook tab), and a new practice task: **Explain in your words**. |
| How speaking works in the tutor | **Hands-free conversation**: the learner turns the microphone on, speaks, and the message sends itself when they finish speaking; the microphone stays on for the next one until they turn it off. Their words appear as they talk. |
| Voice replies | **On request**: a speaker button on each tutor reply reads its prose aloud. |

## Engine: Deepgram

| Option | Why not, or why |
|---|---|
| **Deepgram (chosen)** | Live streaming with words as you speak; **Flux Multilingual** (`flux-general-multi`) knows when a turn ends, and handles Spanish and English mixed in one sentence ("quiero que el agente use un *tool*"). About US$0.47 an hour (US$0.0078 a minute); the US$200 credit covers roughly 400 hours. **Aura-2** speaks, with Latin American voices that switch between Spanish and English mid-sentence (Selena, Aquila), at US$0.030 per 1,000 characters. |
| Gemini (free models) | Transcribes recorded audio, but doesn't stream: no words while speaking, no turn detection; and the free Flash models allow 20 requests a day. |
| The browser's speech recognition | Only in some browsers, sends audio to Google, and is weak on Spanish mixed with English. |

**Keys.** The Deepgram key never reaches a browser. A server asks Deepgram for a **temporary token** (`POST
/v1/auth/grant`, a JWT valid for 30 seconds; the key needs Member permission), the browser opens its own stream with it,
and the stream stays open after the token expires. Tokens are minted for signed-in learners only, and counted.

- **In the lab:** the tutor panel asks its server extension (`academia_tutor`), which asks the learning service on the
  lab server (`services/learning`, which already knows the learner through the hub); the learning service holds
  `DEEPGRAM_API_KEY` and mints the token. Replies read aloud come the same way: the learning service calls Aura-2 and
  streams the audio back.
- **On the platform** (practice): a server action mints the token; `DEEPGRAM_API_KEY` in Amplify.

## How each part works

**The tutor, hands-free.** A microphone button beside the message box. On: the panel streams the microphone to Flux
(16 kHz linear PCM from an AudioWorklet), shows the words as they come, and on Flux's `EndOfTurn` sends the turn's
transcript as the message. While the tutor answers, listening pauses (so it never hears itself or sends while a reply is
on its way) and resumes after. Off: the stream closes. Turn detection is set to be patient, so a pause to think doesn't
send half a sentence (`eot_threshold` high, `eot_timeout_ms` a few seconds), and the learner can always say more: a
message sent too early is just followed by the next one. Language hints: Spanish and English. A level meter shows the
microphone is hearing them. The microphone needs the browser's permission once; JupyterLab in the lesson page's frame
gets it through the frame's `allow="microphone"`.

**Replies read aloud.** A speaker button on each tutor reply. It reads the reply's prose (code blocks, inline code
longer than a word, and links left out, with a short "code omitted" where code was) with an Aura-2 voice in the
platform's language: Selena (Latin American, switches to English for terms) for Spanish, Thalia for English. Pressing
it again stops it. Turning the microphone on stops any reading.

**Explain in your words.** A new practice task form, `explain`, for the declarative ladder's top stages (produce and
apply) and the procedural ladder's transfer: "Explain, as you would to a colleague, why … / what happens when …". The
task carries a rubric (three to five points a good answer makes, and the misconceptions to watch for). The learner
answers by voice (Nova-3 dictation, words appearing, stopped by hand: an explanation has pauses) or by typing. A model
grades the answer against the rubric (DeepSeek, then the authoring chain), returning which points were made and which
were missed, and a score. Proof before a task joins the pool: a second model writes a good answer and a poor one from
the rubric, and the grader must pass the first and fail the second. It's recorded like any other answer (evidence
`auto`, with the score).

## Build order

1. **Voice in the tutor:** token minting in the learning service; the panel's hands-free microphone with Flux; the
   speaker button with Aura-2; the frame's microphone permission. A new learning-service image and lab image, on the
   server.
2. **Explain in your words:** the task form, its writing and proof, grading, and the practice page's answer box with
   dictation.
3. Tried in production, desktop and phone; docs and tracker.

## Costs and limits

Counted in `ai_request` beside every other AI call (`lib/voice/allowance.ts`), per learner per day: **60 microphone
streams** (a conversation is one stream, however many messages it carries; a stream's length isn't known when it starts,
so streams are capped by count, and the browser closes each after **10 minutes**), and **30,000 characters read aloud**
(about 30 long replies). Each stream is recorded at its worst case (10 minutes of Flux with key terms, US$0.091), each
reading at its price (US$0.030 per 1,000 characters). A typical learner costs a few cents a day.

The key in use has admin permission, so `voiceBalance()` can read what's left of the credit (US$199.99 on 2026-11-06),
for a line on an admin page; the provider can change later by rewriting `lib/voice/deepgram.ts` alone.

## Built so far

| Part | Where | Status |
|---|---|---|
| The provider: temporary grants (Flux for conversation, Nova-3 for dictation, with the course's key terms), Aura-2 speech, the balance | `lib/voice/deepgram.ts` | Built and tried locally |
| The daily allowance and its records | `lib/voice/allowance.ts` | Built and tried locally |
| The learning service's routes, and the lab server's forwarding (MP3 passed through) | `services/learning/server.ts` (`/v1/voice/listen`, `/v1/voice/speak`), `infra/lab/tutor/academia_tutor/handlers.py` | Built and tried locally |
| The tutor panel: Talk (hands-free), Listen on each reply | `infra/lab/tutor/labextension/src/voice.ts`, `panel.ts`, `api.ts`, `strings.ts`, `style/index.css` | Built and tried locally |
| The lesson page's frame allows the microphone and audio | `components/courses/lab-frame.tsx` | Built |

**How the panel does it.** The microphone goes through an AudioWorklet that resamples to 16 kHz 16-bit PCM in 100 ms
chunks (resampled here, since Firefox refuses a 16 kHz AudioContext for a microphone), straight to Deepgram over the
WebSocket the grant names (`["bearer", token]` as subprotocols). Flux's `TurnInfo` updates write the words into the
message box (read-only while the microphone is on); its `EndOfTurn` sends them. While the tutor answers or a reply is
read aloud, the stream sends silence, so it stays open without hearing anything. Listen turns the reply's Markdown
into prose (code blocks become "code omitted", short inline code is read, links keep their text), splits it at sentence
ends into pieces under 1,900 characters, and plays them one after another, fetching the next while one plays.

Tried on 2026-11-06. From a script: a token in about half a second; Aura-2 (Selena) spoke a Spanish sentence with
English terms; streamed to Flux in real time, the words arrived every quarter second and the turn ended about a quarter
second after the voice, at 0.83 confidence; key terms fixed "base de datos" (heard as "enlace de datos" without them),
while "LangGraph" spoken by a Spanish voice still came out as "Langgraf". In a local JupyterLab 4.6.5 with the built
extension, its server part and a stand-in learning service making the real Deepgram calls, with that speech fed in as
the microphone: Talk wrote the words as they came and sent "¿Cómo uso un agente con Langgraf para consultar una base de
datos?" by itself when the sentence ended, the microphone staying on; Listen read the reply with "(code omitted)" for its
code block, and no message was sent while it read. The allowance recorded a stream and a reading and refused a
character past the day's limit. Two fixes from that run: Jupyter's API handler labels every answer as JSON unless told
(the MP3 is now passed with its own type), and the sentence splitter dropped Spanish's opening "¿".
