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
| Admin page: draft, edit, prerequisites, approve, publish | `/admin/practice` (`actions/practice.ts`, `components/admin/practice-graph.tsx`) | Deployed (Amplify job 58) |
| The grader on the lab server, and the platform's client for it | `infra/lab/grader` (`server.mjs`, `harness.py`), `lib/practice/grader.ts`, `pnpm grader:check` | Built and tried locally (below) |
| Practice tasks: writing, the proof gate, the pool, and the admin view | `lib/practice/tasks.ts`, `lib/practice/config.ts`, migration `add_practice_tasks` (`practice_task`), the skill cards' Tasks panel and "Write N missing tasks" on `/admin/practice` | Built and tried locally against the server's grader (below) |

**The review page.** Master-detail, so it fits one screen: the course's lessons on the left (filters for to draft,
to review and done, and a search over lessons and skills), the chosen lesson on the right; each scrolls on its own.
Skills read as text in one language at a time (Español / English); the pencil opens one for editing, with fields
that grow to show all their text (Ctrl+Enter saves, Esc cancels). Prerequisites are coloured chips (hard, soft;
click to switch, × to remove) and "Add" searches the skills before this one. "Approve and next" (key A) approves the
lesson and opens the next one waiting for review; "Approve all" (in the header, after a confirmation) approves
every lesson waiting for review that has skills. The chosen lesson is kept in the address (`?lesson=`). On a phone
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

**Claude (2026-11-06).** Drafting now starts with Claude Opus 5.5, on the platform's Anthropic credit, and the page's
list can start it at Claude Sonnet 5.5, DeepSeek or a free model instead (kept per browser). The authoring chain
(`lib/ai/gemini.ts` `AUTHORING_CHAIN`) is Opus 5.5, Sonnet 5.5, DeepSeek, then the free models; a model that fails
passes the lesson to the next, and a refused or missing key skips that provider's other models. Claude is called
through the official SDK (`lib/ai/claude.ts`) with structured outputs (the draft's schema as JSON Schema, every
object closed), streamed, at low effort (Opus 5.5 and Sonnet 5.5 always think; effort sets how much). Each Claude
attempt stops at 25 s, because an Amplify request is reported to run about 30 s at most; a slower answer falls back to
DeepSeek. The key is `ANTHROPIC_API_KEY`; Claude's whole quota is authoring's (400 requests a day on each model, our
own cap), so the tutor and learners never use it.

Tried on 2026-11-06 with lessons 00.04, 00.05 and 01.03. Opus 5.5: 18 to 21 s a lesson, 6 or 7 skills, the most
precise (it told `dotenv_values` from `load_dotenv`, and marked live-service skills as questions only), about US$0.10
a lesson (about 14,000 tokens in, 2,100 out; about US$13 for the course). Sonnet 5.5: 12 to 13 s, nearly the same
skills, about US$0.05 a lesson (about US$6.50 for the course). DeepSeek: about 7 s, US$0.004. Because Opus's time
is close to the limit, a whole draft has a 27 s deadline (`generateWithFallback`'s `deadline`): each attempt gets at
most the time left, and a fallback with less than 6 s left is skipped rather than started.

**Tried on 2026-11-06** with modules 00 and 01 (18 lessons) on DeepSeek: about 7.6 s a lesson, 5 to 7 skills each.
Module 00 approved and published as `langchain-langgraph-mastery@1`: 52 skills, 72 prerequisites, accepted by
`validateGraph` with no warnings; lk-practice planned a first session on it (28 skills ready, 24 locked behind
prerequisites).

**The grader.** A small Node service beside the hub (`infra/lab/README.md`, "The practice grader"), reached at
`https://lab.academiadelcodigo.com/grader/` with a signed request. Each answer runs in a fresh container from the
lab's student image, so tasks have exactly the course's packages: no network, read-only but `/tmp`, no capabilities,
256 MB, one CPU, 64 processes, 15 s by default, and gVisor on the server (decided 2026-11-06: the server also runs
other work, and gVisor puts a sandbox kernel between hostile code and the server's). The harness runs the answer, then
the task's `test_*` functions, and returns each test's result and message.

Tried on 2026-11-06 on Docker Desktop (runc, as gVisor runs on Linux only): a right answer passed in 0.5 s; a wrong one
failed with the assert's message; a syntax error, network access and a write outside `/tmp` came back as errors; an
infinite loop timed out; a memory bomb was stopped at 256 MB; a fork bomb hit the process limit; a printed fake
result didn't pass; the hidden tests aren't in the answer's environment; an unsigned request got 401; no container was
left behind. A LangChain answer with a fake chat model took 6.7 s on half a CPU and 1.9 s on one, so runs get one CPU.

On the server (gVisor, 2026-11-06), `pnpm grader:check` passed: most answers in 0.3 s, the LangChain one in 2.6 s,
the infinite loop stopped at 6 s, the memory bomb reported as out of memory. One difference from Docker's default
runtime: a fork bomb isn't refused fork by fork; gVisor ends the whole answer once about 20 processes are alive at
once (exit code 2), and the next answer runs normally. The grader reports it as `crashed`, saying the answer probably
started too many processes. Short-lived forks, 80 zombies and 200 threads all ran.

**Practice tasks.** For one published skill and one stage of its ladder, a model writes one task in a form the stage
accepts (choice, fill, predict, code, debug; the form the pool has least of, unless one is asked for), in Spanish and
English, with its key and a short explanation for after the answer. It sees the skill, the stage's meaning, the
lesson's objectives and the pool's latest tasks (so it doesn't repeat them). Then the proof:

- **predict:** the grader runs the snippet; it must print exactly the key, and the "likely wrong" answer must differ.
- **code:** on the grader, the reference solution passes the hidden tests (at least two), and the starter and a
  plausible wrong solution both fail.
- **debug:** the buggy code fails the tests and the fixed one passes.
- **choice and fill:** a model from another provider (DeepSeek when Claude wrote it, Claude Sonnet otherwise) answers
  blind and must give the key. Choice options are shuffled first: models favour putting the answer first.

lk-practice's `admitCandidate` turns the proven candidate into an item (`executable` or `model-checked` proof; the
platform's one configuration, `lib/practice/config.ts`, accepts `model-checked`), `validateItems` checks it against the
published graph, and it's stored as PROVEN. A candidate that fails is stored as REJECTED with the reason, for tuning.
Claude Sonnet 5.5 writes by default (fast, good Python); each task is one call plus its proof, ending by 27 s, so it
fits an Amplify request; the page's "Write N missing tasks" loops over every published stage without a task.

Tried on 2026-11-06 with the module-00 graph: all five forms written and proven, choice and fill in 6 to 8 s (DeepSeek
agreed in under a second), predict, code and debug in 9 to 12 s (on the server's grader); one more from the page in
11 s. The first call with a new response schema took longer (Anthropic compiles a schema once and caches it for a day),
so two first attempts ran out of time; a retry passed.

**Node.js.** lk-practice declares Node.js 24 or later. It ran the same on Node 22 (graph check, plan, status), but the
Amplify build is pinned to Node 24 so the site runs on 24: Amplify picks the runtime by the major version it built
with (nodejs20.x, 22.x or 24.x).

## Roadmap

- "Explain in your words" by voice, once speech-to-text is in the platform: graded by a model against a rubric.
- A placement quiz, so someone who already knows a topic can skip ahead (lk-practice supports placement credit).
- Reminders by email.
