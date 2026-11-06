# Practice engine (milestone 10)

Spaced, adaptive practice of the course's skills, a few minutes a day, on the platform. The planning is
`@intellectif/lk-practice` (0.4.0): per skill and learner it keeps a memory (FSRS-7), an ability per stage and a stage
on a ladder, over a prerequisite graph, as pure functions of a replayable log. It never calls a model or a clock: the
platform supplies the graph, the tasks, the grades and the time, and stores the log.

## Decisions (interview, 2026-11-06)

| Question | Decision |
|---|---|
| Where learners practise | A **Today's practice** page on academiadelcodigo.com: tasks in the page, code in an editor there, graded on the server. Any device, no lab needed. |
| The skill graph | **Drafted by a model from each lesson's objectives; an admin reviews and approves it** before learners see it. |
| Task kinds | **Code tasks with tests**, **recall questions** (multiple choice, fill in the blank, predict the output) and **debug a broken snippet**. "Explain in your words" waits for speech-to-text (roadmap): typing explanations is tedious. |
| Session | **A short daily set**, about 10 to 15 minutes: what is due first, then a few new skills, then "done for today". |
| Where code runs | **A grader service on the lab server**: each answer in a throwaway container with no network and capped CPU, memory, processes and time. The platform calls it over HTTPS with a shared secret. |
| When a skill enters practice | **When its lesson is completed** (Mark as complete), and when the tutor's "practise this in a few days" names it. |
| When tasks are written | **A pool per skill, written and proven ahead of time, topped up** in the background when it runs low. |
| What brings learners back | **A due badge** in the header, **a streak** (days with the daily set done) and **a progress map** (each skill's stage and next review). |

## The skill graph

- **Drafting.** For each lesson, a model reads the objectives, the lesson's text and the course outline. It proposes
  skills: an id, a label and description in Spanish and English, `knowledge` (declarative or procedural), the task
  forms that fit, and a criteria hint for graders. It also proposes prerequisite edges to skills of earlier lessons,
  `hard` or `soft`. Skills are small and checkable ("read an environment variable with a default", not "configuration").
- **Review.** An admin page lists each lesson's proposed skills and edges. The admin edits, merges, deletes, adds and
  approves. Approving publishes a new graph version (`<course>@<n>`), checked with `validateGraph`.
- **Changes.** A new version keeps learners' history: their state is rebuilt from the log against it (`replay`).
- **Missing prerequisites.** When a learner fails a skill twice in a row, lk-practice can test a model's guess at a
  prerequisite the graph lacks with short probes. Only a confirmed one becomes a soft edge, and the admin decides
  whether to keep it (`prerequisiteReport`). This comes last in the milestone.

## Tasks

All tasks are in the learner's platform language (generated in Spanish and English together). Code runs as plain
Python with the course's packages and no network: no real model calls, and LangChain tasks use its fake chat models.

| Kind | What the learner does | How it's graded | Proof before a learner sees it |
|---|---|---|---|
| Recall: multiple choice, fill in the blank | Picks or types an answer | Instantly, against the key | A second model answers it blind and must match the key |
| Recall: predict the output | Says what a snippet prints | Instantly, against the key | The grader runs the snippet and must print the key |
| Code | Writes a small function or block | Tests, in the grader | The reference solution passes, a wrong solution fails |
| Debug | Fixes a broken snippet | Tests, in the grader | The broken snippet fails, the reference passes |

- **The pool.** Each skill keeps a pool of proven tasks per stage and difficulty (lk-practice's `generationRequest`,
  `checkCandidates`, `admitCandidate`). When a skill's pool runs low, a background job writes more. Generation uses
  the free Gemini models within their quota, at quiet hours first; learners never wait for a model.
- **Feedback.** Each task carries a short explanation and, for code, the tests' names. After a wrong answer the
  learner sees what failed and the explanation, and can open the lesson. No live model call.

## A session

- **The plan.** lk-practice's `plan` picks the targets: due reviews first, then stage-ups, then new skills in
  prerequisite order. The budget is about 8 targets a day, with at most 3 new skills; a large backlog holds new skills
  back. Each target gets a proven task from the pool at the learner's difficulty, about 85% expected success.
- **Recording.** Each answer becomes evidence (`record`). The new state and the appended log entries are saved in
  one transaction. The answer time matters: fast is easy, slow is hard.
- **Done for today.** When the set is done, the page says so and offers "a few more". Extra tasks move ability, not
  the schedule: one sitting is one review.
- **Entry.** Completing a lesson adds its skills to the learner's focus set; they appear as new skills in the next
  session. A tutor practice request names a skill in words: the platform matches it to a graph skill and adds it.

## Habit

- **The due badge** in the header: practice due today, from the stored state (no model call).
- **The streak:** days in a row with the daily set done, in the learner's own time zone.
- **The progress map:** every skill by module, with its status (locked, ready, learning, reviewing, mastered), stage
  and next review, from lk-practice's `status`.

## Where it runs

| Part | Where |
|---|---|
| Graph, pool, log, learner state | The platform's database (new tables) |
| Planning and recording (lk-practice) | The platform's server code. lk-practice needs Node.js 24: checked first; if Amplify's runtime is older, these run in the learning service on the lab server (Node 24), which the platform calls |
| Task generation and its proofs | A background job: the generation through the platform's AI chain, the proofs through the grader |
| Grading code | The grader service on the lab server, behind nginx at `lab.academiadelcodigo.com`, with a shared secret |

## Build order

1. Tables, graph drafting and the admin review page; the Node.js 24 check.
2. The grader service (local, then the server), its sandbox limits and its tests.
3. Task generation with the proof gate, and the pool top-up job.
4. The practice page: plan, tasks (editor for code, inputs for recall), grading, feedback, done for today.
5. Entry from lesson completion and the tutor's requests; the due badge, streak and progress map.
6. Missing-prerequisite discovery.

Deploying: a migration, the platform, and on the server the grader service and an nginx route, step by step at the
end of the phases that need them.

## Built so far

| Part | Where | Status |
|---|---|---|
| Graph tables: skills, prerequisites, lesson review, published versions | migration `add_practice_graph` (`practice_skill`, `practice_skill_edge`, `practice_lesson_draft`, `skill_graph_version`) | Built, local |
| An authoring share of the AI quota, so admins' drafting never takes learners' requests | `lib/ai/quota.ts` (`AUTHORING`: 100 a day on each Flash-Lite model, 300 on DeepSeek, none on the two Flash models) | Built, local |
| Drafting a lesson's skills | `lib/practice/draft.ts` | Built and tried (below) |
| Publishing a version, checked by lk-practice | `lib/practice/graph.ts` | Built and tried (below) |
| Admin page: draft, edit, prerequisites, approve, publish | `/admin/practice` (`actions/practice.ts`, `components/admin/practice-graph.tsx`) | Built; production build clean |

**The review page.** Master-detail, so it fits one screen: the course's lessons on the left (filters for to draft,
to review and done, and a search over lessons and skills), the chosen lesson on the right; each scrolls on its own.
Skills read as text in one language at a time (Español / English); the pencil opens one for editing, with fields
that grow to show all their text (Ctrl+Enter saves, Esc cancels). Prerequisites are coloured chips (hard, soft;
click to switch, × to remove) and "Add" searches the skills before this one. "Approve and next" (key A) approves the
lesson and opens the next one waiting for review. The chosen lesson is kept in the address (`?lesson=`). On a phone
the list sits above the lesson and picking one scrolls to it.

**Drafting.** The model gets the course outline, the lesson's objectives and prerequisites, the notebook itself
(fetched from GitHub at the imported commit: Markdown whole, code shortened, outputs left out), and every skill of
the earlier lessons. It answers with the lesson's skills as JSON. Keys are normalised and unique in the course; a key
an earlier lesson has is dropped as a repeat; a prerequisite must point back. Redrafting keeps skills whose key
stays, with the prerequisites later lessons drew to them.

**Which model.** Tried on 2026-11-06 with lessons 00.04 and 00.05. Gemini 3.1 Flash-Lite (4 to 8 s) gave 3 and 4
skills, missed objectives (which value wins with `override`) and called "list Groq's live models" runnable
offline. DeepSeek V4.1 Flash (about 7 s) covered every objective, judged runnable correctly (live-service skills get
questions only) and gave sensible prerequisites. The page therefore defaults to DeepSeek, at about US$0.004 a
lesson (about US$0.60 for the whole course); its list can choose the free models instead.

**Tried on 2026-11-06** with modules 00 and 01 (18 lessons) on DeepSeek: about 7.6 s a lesson, 5 to 7 skills each.
Module 00 approved and published as `langchain-langgraph-mastery@1`: 52 skills, 72 prerequisites, accepted by
`validateGraph` with no warnings; lk-practice planned a first session on it (28 skills ready, 24 locked behind
prerequisites).

**Node.js.** lk-practice declares Node.js 24 or later. It ran the same on Node 22 (graph check, plan, status), but the
Amplify build is pinned to Node 24 so the site runs on 24: Amplify picks the runtime by the major version it built
with (nodejs20.x, 22.x or 24.x).

## Roadmap

- "Explain in your words" by voice, once speech-to-text is in the platform: graded by a model against a rubric.
- A placement quiz, so someone who already knows a topic can skip ahead (lk-practice supports placement credit).
- Reminders by email.
