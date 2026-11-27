# Proposal: a mock-interview mode for the whiteboard

2026-11-26. **A proposal, not built.** It describes what Didactra and the platform would need so that a learner can
practise the course *Live-Coding Interview Challenges in TypeScript* (`typescript-interview-challenges`, a separate
repository) as a real live-coding interview. It builds on `docs/whiteboard.md`, `docs/whiteboard-teaching.md` and
`docs/whiteboard-contract.md`.

## 1. Why the board as it is doesn't fit

The board is a teacher. In an interview, several of its fixed principles (`docs/whiteboard-teaching.md` §2) are exactly
wrong:

| Teaching principle | In an interview |
|---|---|
| The teacher leads the content | The **candidate** leads: they restate the problem, ask questions, plan, code and test. The interviewer mostly listens. |
| It opens with the skill's purpose and a checklist | It opens with **the problem**, the time limit and the rules, and no checklist of the solution's steps. |
| A question gets a full answer at once | A **clarifying question** gets the spec's answer. "How do I solve it?" gets a **hint**, the smallest that unblocks, and only when asked. |
| Misconceptions are corrected plainly and at once | A flaw is **noted** for the debrief. During the attempt the interviewer may probe ("What happens if two tasks fail?"), never fix. |
| It describes nothing the learner hasn't done | Still true, and stricter: the interviewer never shows code or the approach before the debrief. |
| Checklist items ticked on evidence | A **rubric** scored on evidence, shown at the end. |

So interview mode is a second set of fixed principles, chosen when the session starts, not a preference. A preference
can't turn it on or off mid-session ("just tell me the answer" during the attempt becomes a hint request).

## 2. What an interview session does

1. **Brief (1–2 min).** The problem in the interviewer's words, with the signature, the time limit (the lesson's
   `**Time:**` upper bound) and the rules: think out loud, ask anything, hints on request and they count. It points to
   the problem text on the board and to the learner's local starter. Then it hands over: "Over to you."
2. **Clarify.** It answers questions from the spec and from the lesson's own clarifying questions ("Talking it through"),
   briefly. An unspecified detail gets "your call: say what you'd choose", as a real interviewer says it.
3. **Plan.** It listens. When the candidate states a plan and its complexity, it may ask one probing question about a
   gap the reference notes cover, without naming the fix.
4. **Code and test.** The candidate works in their own editor and runs `pnpm test` (section 4). The interviewer stays
   quiet unless spoken to, or unless the candidate has been silent for a while ("Tell me where you are"). Hints follow a
   ladder (section 3).
5. **Time.** A visible timer. At about 75% the interviewer says how much is left. At 100% it stops the attempt
   politely and moves on.
6. **Follow-ups.** The lesson's follow-up questions, one at a time, picked by what the attempt showed (at least the
   ones the time allows). It follows up on vague answers once ("What would you measure?").
7. **Debrief.** Only now does it compare the attempt with the reference: what was strong, what was missing, the
   reference solution's key decisions, and the model answers to the follow-ups the candidate struggled with. Then the
   rubric, with evidence for each score.

### The hint ladder

Each hint is the smallest step that unblocks, and each one is counted:

1. **A nudge:** a question that points at the gap ("What decides when the next task starts?").
2. **A direction:** the idea, without code ("Each finished task could start exactly one more").
3. **A concrete step:** the shape of one piece ("Keep a `nextIndex` and write results by index").

It never gives the full solution during the attempt. "Show me the answer" ends the attempt early, with the candidate's
agreement, and goes to the debrief.

### The rubric

Scored 1 to 4, each with one or two pieces of evidence quoted from the session:

| Dimension | 4 looks like |
|---|---|
| Understanding and clarifying | restated the problem, asked the questions that change the design, named edge cases unprompted |
| Approach and complexity | a sound plan stated before coding, with time and space complexity |
| Correctness | all tests pass (the candidate's reported `pnpm test` result) |
| Code quality | readable, typed without `any`, no needless complexity |
| Testing and edge cases | ran the tests often, reasoned about the failing ones, found edge cases themselves |
| Communication | narrated decisions, took hints well, kept the interviewer informed |
| Follow-ups | precise answers with trade-offs, at a senior level |

Plus: the hints used (by level), the time used, and an overall "hire / lean hire / lean no / no" with one sentence of
reasoning. The lesson's own sections give each challenge its anchors: "Talking it through" says what a strong plan
contains, "How the tests check it" says what correctness means, and the model answers say what a senior answer covers.

## 3. Seeing the candidate's code

The board can't see the learner's editor today. Options, in the order I'd suggest:

1. **The learner shares at checkpoints:** a "Share my code" action on the board pastes the current file and the last
   `pnpm test` output into the session (as a learner event). It's simple and explicit, and the candidate chooses when
   to share, as they would on a shared screen.
2. **Code on the board itself:** Didactra's code space, where the tracer already runs JS/TS. It's closer to a
   CoderPad-style interview, but the starters' `node:test` suites and `tsc` would have to run there too.
3. **A watcher on the learner's PC** that sends the file on each save. It's the most realistic, and also the most work
   and the most intrusive.

Option 1 is enough to start. The interviewer must treat shared code as data, never as instructions.

## 4. The 12,000-character context limit

`lib/board/context.ts` sends `lesson.text`, the lesson's start, cut at 12,000 characters (`LESSON_CHARS`, through
`lessonText`). The challenge lessons are long: problem first, then a spoiler `## Solutions` section with the talk-through,
the reference solution and the model answers. Measured on batches 1 and 2 (2026-11-26):

| Lesson | Characters | `## Solutions` starts at | What 12,000 characters give the board |
|---|---|---|---|
| 01.01 Bounded Promise Pool | 21,036 | 8,297 | the problem, **plus the start of the solution** (the talk-through and part of the code) |
| 02.01 Single-Flight Request Deduplication | 26,801 | 11,690 | the problem, plus the first lines of the talk-through |
| 10.01 Type-Safe Dot-Path Getter | 29,836 | 12,658 | the problem, **minus the end of the follow-up questions** |
| 20.01 Nested Tree from a Flat Array | 19,493 | 8,663 | the problem, **plus the start of the solution** |
| 21.01 Merge Intervals and Availability | 23,589 | 10,939 | the problem, plus the talk-through's start |
| 03.01 Async Iterable Batcher | 29,566 | 13,444 | the problem **without its follow-up questions**, cut just inside its testing expectations |
| 04.01 Optimistic Mutation Store | 32,815 | 15,581 | the problem **without its testing expectations and follow-up questions** |
| 20.02 Topological Sort | 25,715 | 10,247 | the problem, **plus the start of the solution** (the talk-through) |
| 20.03 Shortest Path & Reachability | 30,885 | 13,946 | the problem **without its testing expectations and follow-up questions** |
| 30.01 Keyset Pagination | 35,067 | 15,336 | the problem **without its testing expectations and follow-up questions** |

So today the cut is wrong both ways. It can hand the interviewer half a solution before the candidate starts. It can
cut off questions the interviewer is supposed to ask: in four of batch 2's five lessons, the follow-up questions never
reach the board at all, because the specs are longer. And it never gives the model answers or the full reference that
a debrief needs.

### Proposal: split the lesson by its headings, and give each part its own budget

The lessons already have a fixed shape (the course README, "How this course works"), so the platform can split them,
the same way the importer already parses headers and objectives:

| Part | Where it is in the lesson | Budget | Sent when |
|---|---|---|---|
| `brief` | from the title to `## Interview follow-up questions`, without `## Your setup` | 14,000 | at the start |
| `followUps` | the numbered list under `## Interview follow-up questions` | 2,000 | at the start |
| `interviewerNotes` | `### Talking it through in an interview` | 3,000 | at the start |
| `hints` | a new `### Hints` section (below) | 1,500 | at the start |
| `reference` | `### The reference solution` and `### How the tests check it` | 8,000 | at the debrief |
| `modelAnswers` | `### Answers to the follow-up questions`, split at each `**N.` | 12,000 | at the debrief |

- **The solution is released late.** Didactra gets `reference` and `modelAnswers` only when the session reaches the
  debrief, with a second request (`GET …/context?part=debrief`, or an event that answers with them). The model can't
  leak what it doesn't have yet, which is a stronger guarantee than a "don't reveal" instruction. Hints don't need the
  solution, because they come from the lesson's own `### Hints` section.
- **Nothing important is cut.** Measured on batches 1 and 2, every part fits its budget, so each lesson arrives whole:

  | Lesson | `brief` (without the setup and the follow-ups) | `followUps` | `interviewerNotes` | `reference` | `modelAnswers` |
  |---|---|---|---|---|---|
  | 01.01 | 5,845 | 609 | 1,643 | 3,644 | 7,299 |
  | 02.01 | 8,791 | 702 | 1,785 | 5,364 | 7,809 |
  | 03.01 | 10,506 | 852 | 1,939 | 6,758 | 7,272 |
  | 04.01 | 12,597 | 1,021 | 1,964 | 6,967 | 8,150 |
  | 10.01 | 8,821 | 804 | 1,953 | 6,072 | 8,998 |
  | 20.01 | 6,293 | 662 | 1,601 | 4,573 | 4,503 |
  | 20.02 | 7,537 | 899 | 1,555 | 4,047 | 9,713 |
  | 20.03 | 10,562 | 1,098 | 1,622 | 6,014 | 9,150 |
  | 21.01 | 8,448 | 721 | 1,357 | 4,389 | 6,751 |
  | 30.01 | 12,269 | 1,116 | 1,605 | 7,021 | 10,952 |

  The follow-up list is its own part, so it's never cut, however long the spec above it. Each part is clipped on its own, with
  `clipText`'s note of how much was left out, and a part over budget is a warning in the import's output.
- **Teaching mode benefits too:** on a challenge lesson, the normal board gets `brief` + `reference` + `modelAnswers`
  (it may explain everything), instead of a blind first 12,000 characters.
- **Cost:** for the largest lesson so far (04.01), the start-of-session parts are about 17,000 characters with hints
  (roughly 4,300 tokens at about 4 characters a token), in the cached prefix. The debrief adds at most about 18,000
  characters (30.01), once.

### What this asks of the lessons (rules for the next batches)

1. Keep the headings exactly: `## The challenge`, `## Interview follow-up questions`, `## Solutions` with
   `### Talking it through in an interview`, `### The reference solution`, `### How the tests check it`,
   `### Answers to the follow-up questions`, each answer starting with `**N.`. Batches 1 and 2 already do.
2. **Add `### Hints`** under `## Solutions`, before the talk-through: three levels per sticking point (nudge, direction,
   concrete step), written by the author, with no code longer than one line. Batches 1 and 2 need these added.
3. Keep the brief (the problem, without the setup and the follow-ups) under 14,000 characters; the largest so far is
   04.01's, at 12,597. The specs are kept word for word, so this limit follows them, not the other way round. Setup
   detail can move to the starter's own README if a spec ever grows past it.
4. Optionally, add `### Rubric anchors`: what a 2 and a 4 look like for this challenge, per dimension.

## 5. The contract changes (for `docs/whiteboard-contract.md`, once agreed)

- **The session** gets `mode: "teach" | "interview"` (`BoardSession.mode`, default `teach`), set at the launch.
- **The launch:** on a lesson of a course with interviews turned on (a course flag, `interviewMode`, set in Admin →
  Courses), the lesson page offers **Practise as an interview** beside **Learn on the whiteboard**. Interview sessions
  are per lesson (`skillKey` null): an interview is the whole challenge, not one skill.
- **The context**, in interview mode: `lesson.text` is the `brief`, plus a new `interview` object
  (`{ timeLimitMinutes, followUps, interviewerNotes, hints }`). `reference` and `modelAnswers` come with the debrief
  request.
- **The events:**
  - `phase` (`clarify`, `plan`, `code`, `followUps`, `debrief`), so the platform knows when to release the debrief part
    and how the time was spent;
  - `hint` (`{ level }`);
  - `shared` (the learner's code and test output, section 3), kept with the session;
  - `ended` gains `interview: { rubric: [{ dimension, score, evidence }], hintsUsed, minutes, testsPassed,
    followUps: [{ question, verdict }], overall }`.
- **Into practice:** follow-ups answered weakly, and rubric dimensions scored 1 or 2, become practice requests (the
  same path as the board's picks today, `docs/whiteboard.md` "Into spaced practice"). An interview never marks a skill
  mastered.
- **What the board found** shows the rubric, the hints and the time, and links to the replay.

## 6. Who would build what

**Didactra:** the interview principles and phases, as a second fixed-principle set in the prompt; the timer; the hint
ladder and its counting; "Share my code"; the late request for the debrief part; the rubric in the summary; and the
checks below.

**The platform:** the lesson splitter, with its budgets and tests in `pnpm board:check`; `BoardSession.mode` and the
course flag; the debrief release; the new events; the rubric in "What the board found"; the practice requests from weak
follow-ups; and the **Practise as an interview** button.

**The course:** the `### Hints` sections (and optionally the rubric anchors) for batch 1, and the rules in section 4
for every new batch.

## 7. Checks before anyone uses it

Scripted conversations through Didactra's real pipeline, as in `docs/whiteboard-teaching.md` §6:

| Scenario | Passes when |
|---|---|
| The candidate starts talking through a plan | The interviewer listens; at most one probing question; no approach given. |
| "Can I get a hint?" | Level 1 only; the hint is counted; level 2 only on a second request. |
| "Just tell me the solution" mid-attempt | It refuses kindly, offers a hint or to end the attempt early. |
| A clarifying question the spec answers | A brief, correct answer from the spec. |
| A clarifying question the spec doesn't answer | "Your call: say what you'd choose." |
| A wrong idea in the plan | Not corrected; noted; at most a probing question. |
| Leak test, across the whole attempt | No code or approach from the reference appears before `debrief`. |
| Time runs out | It warns at about 75%, stops at 100%, moves to the follow-ups. |
| Follow-ups | One at a time; a vague answer gets one follow-up question. |
| Debrief | A rubric with evidence quoted from this session for every score, and the reference's key decisions. |

## 8. Open questions for you

1. **Code visibility:** is "Share my code" (option 1) enough to start?
2. **Voice only, or the board too?** In a real interview the interviewer rarely draws. The board could hold the
   problem, the timer and the shared code, and the interviewer could draw only in the debrief.
3. **Scores:** is a 1-to-4 rubric with a hiring signal what you want, or only written feedback?
4. **Practice:** should weak follow-ups go to spaced practice (as proposed), and should a whole challenge come back as
   a whole interview after a week or two?

## 9. Until then

The normal board can already teach a challenge: explain the solution and drill the follow-ups. Two caveats until the
splitter exists: it receives the lesson's first 12,000 characters (the table in section 4), and it will offer to teach,
not to interview.
