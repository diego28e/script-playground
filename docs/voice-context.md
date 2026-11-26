# Context management for the voice teachers

How the lesson teacher ("Ask the teacher", `docs/lesson-tutor.md`) and the practice coach ("Talk it through",
`docs/practice.md`) decide what the model is given on each turn of a spoken conversation, how conversations are stored,
and what was measured. Written so the design can be explained to someone else: each decision says what it is, how it
works, why, and what was rejected.

## The problem

A learner talks to the teacher for a long time: one concept at a time, with "next", "deeper" and follow-up questions.
Before this work the browser kept the conversation and sent the last 16 messages with every question. That had four
faults:

- **The conversation was lost** when the sheet closed. Nothing could be read again later.
- **Memory fell off a cliff.** Message 17 pushed message 1 out, whatever message 1 said ("go slowly, use AWS examples").
- **The browser was trusted** with the history: a page could send any "teacher said" text it liked.
- **Nothing was measured.** Nobody could say how big a prompt was, what it cost, or what the model had forgotten.

## The strategy in one paragraph

The server owns the conversation. Every turn it builds the model's context from five parts in a fixed order, from what
never changes to what changes every turn, so the provider's prompt cache covers almost all of it. Each part has a size
limit enforced in code. When the word-for-word turns outgrow their limit, the older ones are folded into a structured
note (compaction) by a second, background model call; the turns themselves stay in the database. Every turn records
what the context weighed and what was read from cache, and a scripted 21-turn conversation with recall questions checks
that the memory actually works.

## What the model is given

| # | Part | What it holds | Changes | Measured size |
|---|------|---------------|---------|---------------|
| 1 | Role | Who the model is and how it teaches (`lib/voice/teaching.ts`) | Never (per language) | 4,031 characters |
| 2 | Grounding | The course, the lesson's title, objectives and text | Per lesson, the same for every learner | 16,114 characters |
| 3 | Memory | This conversation's note, and the titles of earlier conversations here | When a conversation is compacted | 0 to 2,968 characters |
| 4 | Turns | The newest messages, word for word | Grows by two messages a turn | at most 8,501 characters |
| 5 | Now | The moment the audio was paused at (or the task on screen), then the learner's new message | Every turn | 279 to 2,518 characters |

Parts 1 to 3 are the system instruction. Parts 4 and 5 are the messages, with "now" inside the last message, just above
what the learner said. The code is `assemble` and `turnsFor` in `lib/voice/context.ts`; both are pure functions.

## The decisions

### 1. The server owns the conversation

- **What.** Two tables, `voice_conversation` and `voice_message` (`prisma/schema.prisma`). The browser sends the
  conversation's id and the new message, nothing else.
- **How.** `lib/voice/turn.ts` opens the conversation only if it belongs to this learner, this lesson (or course) and
  this kind of teacher (`openConversation`); otherwise it starts a new one. Each message gets its place from a counter
  raised in the same database statement, so two messages can never take the same place.
- **Why.** The history can't be forged, it survives a closed tab or another device, and the learner can read it again
  (the sheet's **Earlier conversations**), continue it, or delete it.
- **Rejected.** Keeping it in the browser (`localStorage`): free, but lost per device, unverifiable, and invisible to
  any measurement.

### 2. Stable first, volatile last

- **What.** The parts are always in the order of the table above.
- **How.** Providers cache a prompt by its beginning, up to the first character that differs from an earlier request.
  Role and grounding are byte for byte the same for every learner on a lesson, so they are read from cache on every
  turn, across learners. The turns only ever grow at the end. What changes every turn sits in the last message.
- **Why.** Cached input is billed at a fraction and processed faster. Measured: 88% of all input tokens in a 21-turn
  conversation came from cache.
- **Rejected.** Putting the "now" part in the system instruction, where it read naturally. It was built that way first,
  and it was wrong: see "What the measurement caught", case 3.

### 3. A limit for every part, enforced in code

`BUDGET` and `SECTIONS` in `lib/voice/context.ts`:

| Limit | Value | What happens at the limit |
|-------|-------|---------------------------|
| Turns kept word for word | at least the newest 8 messages | Older ones wait for compaction |
| Compaction trigger | 6 more messages beyond those 8 | The older ones are folded into the note |
| Word-for-word turns together | 10,000 characters | The oldest replies are shortened to their first 500 characters, never dropped |
| One message | 4,000 characters | Cut |
| The note | 2,600 characters, as six sections with their own limits | Each section loses its own lines only |
| Titles of earlier conversations | 5 titles, 600 characters | Cut |

- **Why in code.** A model asked for "at most 300 words" goes over. In the measurement it wrote notes of 2,600 to 2,700
  characters when asked for about 1,800. A limit that only exists in a prompt is a wish.
- **Why characters, not tokens.** Counting tokens exactly needs the provider's tokenizer, and the chain falls back
  across providers. Characters divided by four is close enough for a budget, and the real token counts are recorded
  after each call.

### 4. Compaction: a structured note, written in the background

- **What.** When 14 messages are outside the note, everything but the newest 8 is folded into it. The cut always lands
  just before a learner's message, so what stays word for word starts with the learner.
- **How.** `compact` in `lib/voice/turn.ts` runs after the reply has been sent. It gives a model the note so far and
  the turns to fold in, and stores the new note with the place it now covers. The update only applies if it moves that
  place forward, so two compactions racing each other can't undo one another.
- **Why in the background.** This is a voice conversation: the learner is waiting to hear the first word. Compaction
  takes several seconds and must never be on that path. If it fails or is late, the next turn simply sends a few more
  turns word for word and tries again.
- **Why a note with fixed sections, not a free summary.** A free summary keeps the story and loses what a teacher needs
  to carry on. The sections are: `THE LEARNER` (how they asked to be taught, each mistake and whether it was corrected),
  `TOPIC NOW`, `STEP REACHED`, `OPEN` (unanswered questions), `EXACT THINGS GIVEN` (every command, file and number, so
  the teacher never contradicts itself) and `COVERED`.
- **Why the turns stay in the database.** The note replaces them only in what the model is given. The learner still
  reads the real conversation, and the note can be rebuilt with a better prompt later.
- **Rejected.** A sliding window alone (what existed before): cheap, and it forgets the start. Sending everything:
  simple and it caches well, but the prompt grows without a bound. Retrieval over the old turns with embeddings: the
  right tool for searching many conversations, too much machinery for one conversation of a few dozen turns.

### 5. The note's sections are ordered by how long they stay true

- **What.** `THE LEARNER` comes first and keeps its oldest lines. `COVERED` comes last and loses its oldest lines when
  it is full.
- **How.** `fitSummary` reads the model's note section by section, cuts each to its own limit, and writes it back in
  the fixed order under fixed headings. It reads headings with or without a colon, because the same model writes both.
- **Why.** Anything that cuts from the end (a size limit, or the model running out of output tokens) must hit the most
  replaceable content. See case 1 below for what happened before this.

### 6. Interrupted and failed replies

- **Interrupted.** When the learner taps the orb while the teacher is speaking, or closes the page mid-reply, the stored
  reply is marked `interrupted`. On the next turn the model sees the reply followed by "The learner cut you off here:
  they may not have heard the end." Without it the teacher assumes everything it wrote was heard.
- **Failed.** A reply that failed is stored as failed and left out of the context. Its question is joined to the next
  one, so the two sides still alternate.

### 7. Memory across conversations: the learner profile and titles

**The learner's own preferences** (`lib/preferences.ts`, scope `all`; `docs/whiteboard-teaching.md` §2) come first in
memory, under "How this learner asked to be taught". They're word for word, and they outrank the observed notes below.
They're read once per conversation, like the profile, for the cache.

**The learner profile** (`lib/voice/profile.ts`, table `learner_profile`) is what carries over from one conversation to
the next, built 2026-11-23.

- **What.** Notes on the learner, in two parts. Scope `all`, for every course and both teachers: `HOW THEY LIKE TO
  LEARN`, `WHAT WORKS`, `WHAT DOESN'T`, `THEIR GOALS`. One per course: `MISCONCEPTIONS` (each wrong idea, the right one,
  and whether it's corrected), `STILL SHAKY`, `KNOWS WELL` (only what they showed, by explaining, applying or answering
  well, not what was explained to them).
- **How it's written.** In the background, after the reply, like compaction: every 6 new messages in a conversation,
  the model is given the notes so far and the new stretch, and writes the notes again. A short conversation never
  reaches 6, so when the learner starts a new conversation, the ones they left at least 10 minutes ago with anything
  new are learned from too (at most three). Each section has its own size limit, enforced in code (`fitSections`): how
  they learn keeps its oldest lines, what they know keeps its newest. Its own feature in the AI ledger
  (`voice-profile`), never counted against the learner's turns.
- **How it's read.** In the memory part, after the lesson and before the conversation's own note, as "what you know
  about this learner: use it to teach this person better, adapt to how they like to learn, and don't recite it". A
  conversation reads the profile once and keeps that copy (in the service's memory, 6 hours): the profile is rewritten
  every few exchanges, and a change in the system instruction would cost every later turn its cache. What it learns
  reaches the next conversation.
- **The learner sees it and can forget it**: "What the teacher remembers about you", at the top of the sheet's earlier
  conversations, with "Forget it". Deleting a conversation doesn't remove what was learned from it; forgetting does.
- **Why our own, not a memory service.** Zep's self-hosted edition is discontinued, and a hosted one sends learners'
  conversations to a third party, which matters once other teachers' learners are on the platform. The profile is a
  few rows in our own database, written by a call we already make the same way, readable and deletable by the learner.
- **Not yet:** it doesn't read the practice (spaced repetition) state, which knows objectively which skills a learner
  keeps lapsing on; that's the next step for "what they struggle with".

**Titles.** The model is also given the titles of the learner's last five conversations on the same lesson, marked as
"titles only; you don't have their text". That is enough to say "we talked about this before" without pretending to
remember details, and it costs about 50 tokens. A conversation left less than 6 hours ago is continued when the sheet
opens; an older one waits in the list.

### 8. Who said what

The "now" part is labelled "from the platform, not said by the learner", and the learner's words go under their own
heading. The lesson's text sits inside delimiters in the grounding. The model can always tell the platform's facts from
the learner's claims, which matters when a learner types "you told me the answer was X".

### 9. Every turn is measured

Each stored reply carries what its context weighed: the size of every part, how many messages were sent, how many were
shortened, what the note covered, the model, and the tokens (input, output, read from cache). The same goes to the logs
as `voice.turn`, and each compaction as `voice.compacted`. Compaction has its own name in the AI ledger
(`voice-summary`), so it never counts against a learner's turns.

### 10. A change that doesn't break open pages

A page loaded before the deploy still sends its own history and no conversation id. The server keeps answering those the
old way until the page is reloaded. The sheet's history calls return an empty list if the tables aren't there yet, so
the code could ship before the migration.

## Measured

`pnpm voice:context:measure`, on 2026-11-20, local database, model `deepseek-flash`: a scripted learner on lesson
03.08 (DNS), 21 turns, replies of about 209 words.

| Measure | Result |
|---------|--------|
| Compactions | 5 (after turns 7, 10, 13, 16 and 19) |
| Messages sent to the model per turn | 9 to 13 once compaction began |
| Word-for-word turns | 4,367 to 8,501 characters; 24,435 by the last turn if nothing were folded |
| The memory part (the note and the earlier titles) | 2,369 to 2,968 characters; the note itself was 2,493 after the fifth compaction |
| Whole prompt | 20,947 to 30,590 characters; 5,632 to 8,019 input tokens |
| Input tokens, all 21 turns | 153,275, of which 135,040 (88%) read from cache |
| Cache on a compaction turn | 5,248 to 5,376 tokens (role and grounding); back above 7,000 the turn after |
| First words of the reply | 0.78 to 1.32 s, median 1.02 s, no growth across the conversation |
| Recall checks | 3 of 3 passed |

The recall checks are the test of the memory. At turn 20 the learner asks "what did I get wrong at the very beginning,
and how did I ask you to explain things?". By then the first turns were folded away four compactions earlier, so the
model can only answer from the note. It answered both parts correctly, and at turn 21 it recalled the first TTL value
it had given.

A second run moves the audio to another moment on every turn (`pnpm voice:context:measure moving`, lesson 00.04, 6
turns): the "now" part was 2,202 to 2,518 characters and different each time, and the cached tokens still grew every
turn, from 3,712 to 4,992 of 4,543 to 5,984. Only the "now" part and the newest exchange were read fresh.

**What compaction buys, honestly.** At 21 turns it is not a saving in money. Sending everything, append-only, would also
cache almost perfectly; by estimate it would have used about 185,000 input tokens against 153,275, with fewer of them
uncached, because every compaction throws away the cache of the turns. At the list price in `lib/ai/quota.ts`
(US$0.30 per million input tokens before any cache discount) the whole 21-turn conversation's input is under US$0.05
either way. What compaction buys is a **bound**: the prompt stays near 8,000 tokens whether the conversation is 20 turns
or 200, the first words stay at about a second, and the teacher still knows who it is talking to. The discount for
cached tokens is pending verification against DeepSeek's pricing page.

### The learner leads, measured (2026-11-23)

`pnpm voice:context:measure led`: lesson 00.04, paused at 1:00, seven questions from a learner who leads. They ask about
the conflict story (which the recording only reaches three quarters in), what "idempotent" means, push back on the
lesson's ninety seconds, ask for a bad and a good answer, ask a quick fact (how many stories), the commonest mistake,
then "go on". The same conversation was run with the old instructions and the new, on DeepSeek V4.1 Flash.

| | Old instructions | New instructions |
|---|---|---|
| Replies ending with a question | 7 of 7 | 1 of 7 |
| Words a reply | 229 to 338, about 261 on average | 46 to 272, about 169 on average |
| The quick fact ("how many stories?") | 259 words | 46 words |
| Questions put off | none in this script | none |

The old teacher answered the question about later in the lesson here; the putting off the learner met came from the
recording's next words in its context, which this script doesn't happen to trigger. The check stays in the script so it
can't come back unnoticed. The first new version still gave the quick fact 209 words; the length rule was rewritten
around listening ("150 words take a minute; a question with a short answer gets it in one to three sentences") and the
next run gave 46.

The learner profile, from that conversation and the 21-turn one after it, began "Asks for a slow pace and AWS examples
explicitly", "Learns by comparing bad vs good worked examples", "Pushes back on rules and asks for the reasoning behind
them", with the TTL misconception marked corrected and "what idempotent means" as still shaky. With the profile in the
memory part, the 21-turn conversation's recall checks still passed, and the memory part grew to about 3,700
characters. The recall check for an exact value had only counted values in backticks; the teacher recalled "60", said
in a sentence in its first reply, so numbers count now too.

## What the measurement caught

Three faults were found by running the measurement, not by reading the code. Each is a short story worth telling.

**Case 1: the note forgot the learner.** The first version had one limit on the whole note (1,600 characters) and put
`THE LEARNER` fourth. The model wrote long notes, the limit cut the end, and the note was then rewritten from its own
cut version. At turn 20 the teacher answered: "I don't have a record of you getting anything wrong at the start of this
conversation, and you didn't tell me how you wanted things explained." Both were false. The fix was a limit per
section, enforced in code, with the sections ordered by how long they stay true. The same question then passed.

**Case 2: the format changed under the parser.** After that fix, one run produced headings without colons
(`THE LEARNER` on its own line). The parser found no sections and fell back to cutting the whole note, which lost the
last two sections. The recall checks still passed, so only the printed note showed it. The fix: read both forms, and a
rule check for each. The lesson: a model's output format is an input to validate, not a contract.

**Case 3: something volatile above something stable.** The "now" part (the moment in the audio) was in the system
instruction, above the turns. The first measurement held the audio at one moment, so it showed almost everything
cached and hid the fault. A change in that part would have made the provider re-read every turn after it. It moved to
the last message, a rule check now compares two consecutive requests byte for byte, and the second run above proves it
with real cache numbers.

Also found on the way: the note's output limit (700 tokens) cut some notes mid-line; it is now 1,100, and because the
most replaceable section is last, a cut there costs the least.

## Daily limits

Two limits of ours remain on the voice teachers, both on the model, none on Deepgram (`docs/voice.md`, "Costs"):

- **Per learner:** 300 questions a day to the lesson teacher and 400 turns a day with the coach (`TURNS_PER_DAY`,
  `COACH_TURNS_PER_DAY`). Compaction's summaries don't count against them.
- **For everyone together:** 1,700 requests a day on `deepseek-flash` for learners (`lib/ai/quota.ts`; 2,000 less
  authoring's 300). The teachers' turns and their summaries (about one for every three turns) both count. Past it, the
  chain goes on with the free Gemini models, so the teacher keeps answering, on a weaker model.

## What it doesn't do yet

- **No search over old turns.** Once a detail leaves the note (the oldest lines of `EXACT THINGS GIVEN` go first), the
  model can't get it back, though the learner can still read it. A tool that looks up old turns would fix that.
- **The note is written by the cheapest model.** It sometimes puts lesson progress under `THE LEARNER`. The section
  limits contain the damage; a stronger model for compaction would reduce it.
- **The profile doesn't read the practice state** yet (which skills a learner keeps lapsing on in spaced repetition);
  it learns only from conversations.
- **Compaction can arrive one turn late** when turns come faster than it runs (seen once at 5 seconds between turns).
  By design the turn then just carries more messages.
- **The evaluation is one scripted conversation** in English with keyword checks. It catches a broken memory; it does
  not grade teaching quality.

## Explaining it in an interview

Short answers to the questions this is likely to raise.

- **"What is context engineering here?"** Deciding, for every turn, what the model reads and in what order, with a
  size limit on each part, and measuring the result. The prompt's wording is only one part of it.
- **"How do you keep a long conversation from blowing up the prompt?"** The newest 8 to 14 messages go word for word.
  Older ones are folded into a structured note by a background call. The prompt stayed near 8,000 tokens over 21 turns
  while the full history tripled.
- **"Why not just send the whole history? Context windows are huge."** At this length it would even be a little
  cheaper, and I measured that. I bound it because voice sessions have no natural end, the first word should arrive in
  a second, and the conversation has to be resumable days later from the same state.
- **"How do you know the summary keeps what matters?"** A scripted conversation asks, at turn 20, about something from
  turn 1 that was folded away four compactions earlier. The first version failed that check; the fix made it pass.
- **"How does prompt caching shape the design?"** Everything is ordered by how often it changes. The lesson text is
  identical for every learner, so it is cached across learners; 88% of input tokens were cache reads. I also found and
  fixed a part that changed every turn sitting above the turns.
- **"What happens when the summary call fails?"** Nothing the learner notices. It runs after the reply; a failure means
  the next turn sends a few more messages and tries again. The stored update is conditional, so a late compaction can't
  overwrite a newer one.
- **"What did you get wrong?"** The three cases above. The common thread: each was caught by measuring real runs, and
  each ended as a deterministic check so it can't come back unnoticed.
- **"What would you do next?"** Search over old turns as a tool, a per-learner profile across conversations, and a
  stronger model for compaction, in that order.

## Where it lives

| What | Where |
|------|-------|
| The parts, limits, the turns sent, the note's format (pure functions) | `lib/voice/context.ts` |
| One turn: build the context, call the model, store both sides, compact | `lib/voice/turn.ts` |
| Storage: open, append, mark interrupted, save the note, list, delete | `lib/voice/conversations.ts` |
| The lesson teacher's and the coach's own parts (role, grounding, now) | `lib/lesson-tutor/turn.ts`, `lib/practice/coach.ts` |
| The sheet: resume, new conversation, earlier conversations, delete | `components/voice/voice-tutor.tsx`, `actions/voice-conversations.ts` |
| Tables | `VoiceConversation`, `VoiceMessage` in `prisma/schema.prisma` |
| Rule checks, no database or model (26 checks) | `pnpm voice:context:check` |
| The live measurement with recall checks | `pnpm voice:context:measure` |
