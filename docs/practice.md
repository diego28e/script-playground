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
| Practice tasks: writing, the proof gate, the pool, and the admin view | `lib/practice/tasks.ts`, `lib/practice/config.ts`, migration `add_practice_tasks` (`practice_task`), the skill cards' Tasks panel and "Write N missing tasks" on `/admin/practice` | Deployed (Amplify job 62) |
| Today's practice for learners: state and log, the daily set, grading, retries on code, a few more | `lib/practice/learner.ts`, `actions/practice-learner.ts`, `/practice/<course>` (`components/practice/practice-today.tsx`), migrations `add_practice_learners` and `rescale_task_difficulty`; a "Practise today" button on the course page | Deployed (Amplify job 63) |
| Entry from the tutor's requests; the due badge, streak and progress map; a `/practice` index | `lib/practice/learner.ts` (`focusSkills`, `practiceDue`, `practiceStreak`, `progressMap`), `components/practice/practice-nav-link.tsx`, `/practice`, `/practice/<course>/map` | Deployed (Amplify job 64) |
| Missing prerequisites: diagnosis, probes, the learner's own graph, the admin's Discovered view | `lib/practice/discovery.ts`, `lib/practice/learner.ts` (`loadLearner`, `composeLearnerGraph`), migration `add_practice_discovery` (`practice_diagnosis`, `practice_found_skill`, `practice_discovered_edge`, `practice_learner.extensions`), `components/admin/practice-discoveries.tsx` | Deployed (Amplify job 65) |
| Going back to earlier tasks; hints by DeepSeek; editing a task by hand or with a model | `components/practice/practice-today.tsx`, `lib/practice/hints.ts`, `lib/practice/tasks.ts` (`aiEditTask`, `saveTaskEdit`), `components/admin/practice-task-editor.tsx`, migration `add_practice_hints` (`practice_hint`, `practice_task.editedFromId`) | Built and tried locally (below) |

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

**Difficulty.** lk-practice reads an item's difficulty in logits against the learner's ability (a newcomer's is 0)
and aims tasks at 85% expected success, which is -1.73 for a newcomer, within 0.5. The writing model rates a task from
-1 (easy for its stage) to 1 (hard), 0 typical; `toItemDifficulty` maps that to -1.73 ± 0.8, about 93% to 72% expected
success. The admin page shows "expected success" rather than logits. (The first tasks, written with the rating as the
difficulty, are rescaled once by the migration `rescale_task_difficulty`.)

**Today's practice.** `/practice/<course>`, for enrolled learners (and admins), linked from the course page:

- **The state.** `practice_learner` holds lk-practice's state for the learner and course, a cache of the log in
  `practice_log_entry` (append-only). When a new graph version has been published, the state is rebuilt from the log
  with `replay`.
- **The daily set.** Planned once per day, in the learner's time zone: `plan` with the learner's state, the skills of
  the lessons they've completed as `focusSkills`, the proven tasks as the pool, a budget of 8 tasks and 15 minutes, and
  at most 3 new skills. While a pool is thin, a target with no task within lk-practice's tolerance gets the closest
  proven task for the same skill and stage. A target with no task at all waits for the pool.
- **Answering.** Choice, fill and predict are graded against the key; code and debug run on the grader. A code task can
  be run as often as the learner likes: each run shows which tests fail, and the answer is recorded when every test
  passes (with the number of runs as `attempts`, so a fix after a failed run counts as harder) or when they give up.
  Each answer becomes lk-practice evidence (`auto`, with the score, the time taken and the attempts); the new state and
  the appended log entries are saved with the answer in one transaction. The learner then sees whether it was right,
  the key or the tests, and the explanation.
- **Done for today**, with how many were right, and "a few more": up to 4 tasks on the skills already started, at their
  current stage, never new skills (the daily cap holds); lk-practice counts one sitting as one review, so these move
  ability, not the schedule.
- Learners only ever receive a task's question side: never its key, tests or solutions.

Tried on 2026-11-06 locally (production build, Spanish, dark, desktop and phone): with lesson 00.01 completed, the plan
gave 3 new skills (the daily cap), each with a task; a right and a wrong answer were recorded as evidence (3 log
entries, 3 skills in the state); reloading gave the same set; "done for today" with the score; "a few more" gave a set
on the started skills; a debug task failed 2 of 4 tests on its buggy code, then passed all 4 after the fix, recorded with
2 attempts; no sideways scroll at 375 px. The first version planned nothing: the tasks sat at difficulty 0, outside
lk-practice's tolerance of its -1.73 target, which led to the difficulty mapping and the closest-task fallback above.

**Entry and habit (phase 5).**

- **Focus skills** are the skills of the lessons the learner has completed, plus those the tutor offered to practise.
  A tutor request names a skill in words and the lesson it came from; it's matched to that lesson's skill with the
  most words in common (key and both labels, lowercase, no accents, words of 3 letters or more). A request that matches
  nothing is left out.
- **The due badge.** "Práctica" in the header (and in the account menu, which is how phones get there) shows how many
  tasks wait today: what's left of today's set, or, before it's planned, the reviews due plus the new skills waiting
  that have a task (at most the daily cap). No planning and no model call; it's asked again on every page change and
  after each answer.
- **The streak:** days in a row with the daily set finished (with at least one answer), in the learner's time zone,
  ending today, or yesterday while today's set isn't done. It shows under the course title on the practice page.
- **The progress map** (`/practice/<course>/map`): every skill by module and lesson, coloured by lk-practice's status
  (mastered, credited, reviewing, learning, ready, locked, suspended), with "comes with its lesson" for a skill
  lk-practice would start but the learner hasn't reached; for a started skill, its rung on the ladder, when it comes
  back and its recall.
- **`/practice`** goes straight to the course when the learner has one with practice, and lists them otherwise.
- **An empty daily set isn't kept:** one planned before the learner reached any skill (or before its tasks were
  written) is planned again on the next visit, so a lesson completed later in the day counts the same day.

Tried on 2026-11-06 locally (production build, Spanish, desktop and phone): with lessons 00.01 and 00.02 completed,
the badge said 3 before planning, 2 once the set was planned (the planner's choice within 15 minutes), 1 after the
first answer and none after the second; the streak went from "start your streak today" to "1 day in a row"; the map
showed 2 learning (one rung, back tomorrow, 99% recall), 5 ready, 21 coming with their lesson and 24 locked. The
first try found the empty-set problem above: the page had planned an empty set before the lessons were completed,
and kept it for the day.

## Missing prerequisites

Built on lk-practice 0.4's discovery (its guide, "Missing prerequisites"). A model only ever proposes; short probes on
the prerequisite alone decide.

1. **Notice.** When an answer makes lk-practice emit `skill.diagnosis-suggested` (the skill failed twice in a row at its
   stage), the answer's reply carries a diagnosis id (`practice_diagnosis`, at most 3 a learner in 24 hours, one at a
   time per skill). The answer is recorded either way.
2. **Ask.** The page runs it in the background (`runPracticeDiagnosis`, under 25 s). Claude Sonnet 5.5 (then the
   authoring chain) gets lk-practice's facts (`prerequisiteRequest`: the blocked skill and stage, its prerequisites, the
   skills near it, what's already been tested for this learner), the last two attempts (the task, the key or the tests,
   what the learner gave), and the course's skills except those that build on the blocked one. It names at most two
   gaps: a course skill by id, or a new skill the course doesn't teach (key, labels and description in both languages,
   declarative or procedural, runnable or not), each with a one-sentence reason, or nothing when it looks like a slip.
3. **Check and open.** A new skill becomes `found.<key>`, shared by the course (`practice_found_skill`): a second learner
   with the same gap probes the same skill and its tasks. Proposals the admin dismissed for that skill are dropped.
   `checkPrerequisiteHypothesis` checks the rest (cycles, duplicates, what's open or refuted); each accepted one is opened
   in the learner's log (`open-hypothesis`) and counted on the course's proposal (`practice_discovered_edge`).
4. **Probe.** `preparePracticeDiscovery` adds to today's set two probes per open hypothesis (distinct tasks at the
   candidate's top stage), writing and proving a task when there's none (one per call; the page calls up to four times).
   A probe is answered like any task, recorded with `probe` and context `diagnostic`: it changes no skill. Two failed
   probes confirm; a pass share of 0.75 or more refutes (two of two); a split asks for more on later days, where
   lk-practice plans probes first.
5. **Confirm.** A confirmed hypothesis's `discoveryExtension` is stored on the learner (`practice_learner.extensions`).
   Their graph is now the published one composed with their extensions (`composeLearnerGraph`), plus the new skills of
   their hypotheses without edges (so probes on them record and replay); `loadLearner` replays the log whenever that
   graph's version differs from the state's. A groundwork task on the prerequisite joins today's set, and lk-practice
   plans it first (`remediation`, reason `discovered`) and re-probes it until it's ready, while the blocked skill waits.
6. **The admin decides.** `/admin/practice` → "Discovered (N)" lists each proposal (found skills marked), the model's
   reason, how many learners probed, confirmed and refuted it, and lk-practice's advice across them
   (`prerequisiteReport`: practising it, harden, revoke, keep). "Add to the course" makes a found skill a skill of the
   lesson it was found in, keeping its key so learners' history follows it, and adds a soft prerequisite; it applies
   with the next published version. A learner's own extension then gives way to the course's edge (it no longer
   composes and is dropped), and their log replays with every verdict kept. "Dismiss" stops the proposal being made
   again; it can be undone.

The learner sees: a notice while the diagnosis runs ("we're looking at whether something underneath is missing"), then
how many check questions joined the end of the set; probe cards marked "Check" with a line saying they don't count
towards progress; after a verdict, "found something underneath: X, you'll practise it before Y" or "you know X: that
wasn't it"; groundwork cards marked "Groundwork"; and on the map, a confirmed prerequisite under the lesson it was found
in, with its own mark.

Tried on 2026-11-06 locally, with real calls (production build, Spanish). Two wrong answers on "Create, edit and
render a Markdown cell" asked for a diagnosis; Sonnet answered in 4.5 s with two new skills ("Recognise basic Markdown
syntax", "Tell Markdown cells from code cells") and reasons that quoted the wrong option picked twice. Four probes and a
groundwork task were written and proven (Sonnet, checked by DeepSeek). Two failed probes confirmed the first: the
learner's graph became `…@1+e48e…` (54 skills, 73 prerequisites) and lk-practice's next plan was the other probe, then the
confirmed skill (`discovered`), then new skills. On the page, failing a second skill twice showed the notice and added
two probes about ten seconds later; answering both probes of the Markdown-cells hypothesis right refuted it, with the
notice; the groundwork card, the map tile and the admin dialog showed as described, and "Add to the course" added the
skill and edge. Replaying that learner's log on a graph with the skill added kept all three verdicts and every entry.
The first diagnosis named a course skill that builds on the blocked one, which `checkPrerequisiteHypothesis` refused
as a cycle; since then the model isn't shown those skills.

## Going back, hints and edits

**Going back.** A row of numbered steps sits above the task: green for right, amber for wrong, outlined for the task
still open (a probe shows a magnifier). The learner can open any task they've answered, with its answer, feedback and
hints, and the first one still open; tasks after it stay locked until they get there. Each task also has "Previous".

**Hints.** Before answering, "Hint" asks DeepSeek V4.1 Flash (then the free Gemini models, in the tutor's pool) for
one or two sentences written for the learner's attempt so far: the option they lean towards, what they typed, or their
code. Up to three a task, each more specific (hint 1 names the idea, 2 where to look, 3 nearly there), and 40 a learner
in 24 hours. The model sees the key, to steer by, and is told never to give it or echo its wording. A hint that gives
it away anyway is refused and asked for once more: for choice, fill and predict tasks by lk-core's `hintRevealsAnswer`
(the check the OCW quizzes' AI hints use; a predict task's output counts as the answer), for code by any code block or
line of the solution. Hints are kept (`practice_hint`), shown again when the learner goes back, and counted on the
server into the answer's evidence (`hintsUsed`), so a hinted right answer counts for less; the page says so after
answering. DeepSeek's daily cap went from 500 to 1,000 for this (300 still authoring's), at about US$0.0006 a hint.

**Editing a task.** On `/admin/practice`, each task (proven or rejected) has "Edit": every field of its form (prompts,
options and the right one, accepted answers, code, expected output, tests, solutions, explanations, difficulty and
time). "Edit with AI" takes an instruction and a model from the authoring list (Claude Sonnet by default) and fills
the fields with its rewrite; nothing is saved until the admin saves. Saving proves the task again like a new one: code
on the grader, a question answered blind by a model other than the one that edited it (DeepSeek for a Claude edit,
Sonnet for an edit by hand). When it passes it joins the pool as a new task (`editedFromId` points back) and the old
one is retired, so past answers keep pointing at what learners saw; when it fails, the reason shows and nothing
changes.

Tried on 2026-11-06 locally (production build, Spanish): two DeepSeek hints on a choice task, each more specific; the
answer's evidence recorded `hintsUsed: 2` and the page said so; "Previous" and the steps went back to it with its
answer, feedback and hints, while the third task stayed locked. The first hints echoed the right option's wording, so
the prompt now forbids that and keeps hint 1 general; after that, hint 1 on another task named the idea without the
key's words. On the admin page, "make the options about the same length" with Sonnet came back in about 10 s, and saving
it was proven by DeepSeek and retired the original; moving the right-option mark to a wrong option by hand was refused
("claude-sonnet-5-5 answered 3, not the key") with nothing saved.

**Node.js.** lk-practice declares Node.js 24 or later. It ran the same on Node 22 (graph check, plan, status), but the
Amplify build is pinned to Node 24 so the site runs on 24: Amplify picks the runtime by the major version it built
with (nodejs20.x, 22.x or 24.x).

## Finding and fixing a task

Built 2026-11-09. A task found wrong or unclear is one search away, and fixed with the task editor (above: an edit is
proven again and replaces the task, which is retired; answers already given keep pointing at the old version).

- **Admin → Practice → Tasks** (`/admin/practice/tasks`, `actions/practice-tasks.ts`,
  `components/admin/practice-task-finder.tsx`): every task of a course. Search its words in either language (the whole
  content: prompt, options, answers, explanations, code); narrow by lesson, skill (found and tutor skills under the lesson
  they were found for), form, stage and status (in use, rejected, retired, all); sort by newest, most missed or most
  answered. Each task shows its lesson and skill (click to filter by them) and how learners did ("12 answers · 25%
  right", in amber when most of at least three answers are wrong: check the wording and the key). The filters are in
  the address, so a search can be shared; `?task=<id>` opens that task in the editor.
- **From your own practice:** an admin sees **Edit** on every task card of the practice page
  (`components/admin/practice-task-edit-button.tsx`), which opens the editor right there, and **All tasks**, which opens
  the finder on that task. Learners never see either: the page passes the editor's models only to an admin. The
  session in progress keeps the task it had; the next sessions get the new version.

## Practice from the tutor

Decided with the admin on 2026-11-07: practice the tutor asks for starts right away for that learner, with no approval;
its tasks are code first; code tasks carry a recipe, open at a skill's first stages and earned at later ones.

**In the lab.** The tutor's panel offers "Practise «skill» in a few days" when a detour closes, and when the learner
asks for more practice or challenges on something (the tutor's `offer_practice` action, docs/ai-tutor.md). One click
stores a practice request: the skill in the tutor's words, the lesson, how it came (`PASSED` or `SKIPPED` a detour,
`REQUESTED` more practice) and the last six messages, which hold the detour's explanation and the challenge.

**Resolved on the next practice visit** (`lib/practice/tutor-requests.ts`), one request per call of the page's
background step, once. Before, a request was matched by shared words to a skill of its lesson: "finding binding
capacity constraints with min" went to `compute-free-tier-capacity`, the lesson's arithmetic, not the `min()` syntax the
learner wanted, and a request with no words in common was dropped. Now Claude Sonnet reads the request and the
conversation with the course's skills and the found ones, and answers:

- a course skill or found skill, when it is that same narrow skill (not a broader one that uses it): practised as is;
- otherwise a new narrow skill ("use `min()` to find the binding limit among several capacities"), with labels and a
  description in both languages, its kind, whether plain Python practises it, what a right answer shows, the lesson
  skill it is part of (the anchor), and a few sentences on what the tutor's challenge looked like.

A new skill is stored as a found skill of the course (origin `TUTOR`, with that context), so a second learner who asks
for the same thing gets the same skill and its tasks. It joins the learner's graph as lk-practice's goal extension: the
lesson skill *encompasses* it (an edge into the new skill, so nothing waits on it, and practising the lesson skill
counts a little for it), checked by `checkDecomposition` and admitted by the learner (`admitExtension`, `by: learner`),
then composed into their graph with a replay of their log, like a confirmed prerequisite. It also appears among the
course's discoveries ("From the tutor: …"), where the admin can add it to the course for everyone. A request no model
can resolve in three tries is set aside (`none`).

**Code first.** A tutor's skill gets code-first forms (`tutorSkillForms`): procedural, the usual case, writes code from
its first stage (example: code or predict; complete: debug or code; write: code; transfer: code or debug); declarative
keeps multiple choice only to recognise. The task writer is told what the tutor's challenge looked like and writes in
the same spirit: a small realistic scenario with concrete numbers where the skill is the heart of the solution.

**In the learner's practice.** The skill is in their focus from the day after the request. The page's background step
(`prepareDiscovery`) adds it to the day's set when lk-practice hasn't started it yet, and again when it's due; when its
stage has no proven task, one is written and proven there and then (about 10 to 15 seconds for code, on the grader),
so no admin batch is needed. From there lk-practice schedules it like any skill. Its tasks show "From your tutor".

## Recipes

A code task carries a recipe: three to seven steps in plain words, in both languages, that walk a learner from the
starter to a solution (what to compute, in what order, what to call each result), like the tutor's step-by-step
challenges. It never shows code: `recipeProblem` refuses a step with a code block, a backticked call, operator or
expression (a backticked name is fine), or a line of the solution, before the task is proven. Every new code task has
one; an admin can edit it ("one step per line") with the task's other fields. The model writing a task gets a schema of that form's fields only, all
required (`schemaFor`): with the recipe, the schema of every form's fields at once was more than Claude's structured
outputs accept ("Schema is too complex"), which showed as Sonnet timing out and DeepSeek writing the task instead.

Tried locally on 2026-11-07 with the `min()` detour replayed as a request (the tutor's audio-chunks challenge in its
messages): Sonnet resolved it in 6 s to a new skill, "Use min() to find the binding limit among several capacities",
anchored to `compute-free-tier-capacity`; lk-practice admitted it into the learner's graph; the next day's set got a
code task for it, written by Sonnet in 14 s and proven on the grader (three limits per minute: requests, tokens and
audio seconds, with a six-step recipe); the page showed it with "From your tutor" and the recipe open at its first
stage; a right answer started the skill, next review the following day. Two DeepSeek tasks written earlier were
rejected by their proofs (one recipe quoted a value, since allowed; one reference solution failed its own test).

On the practice page (`lib/practice/recipes.ts`) the recipe is open at a skill's first stages (recognise, recall,
produce, example, complete), guiding the learner. At later stages (write, apply, transfer) recall is the point: the
recipe waits behind "Show the recipe", the page gets its steps only once it's shown, and showing it is recorded as hint
0 of the task: it counts in the answer's evidence like a hint (a right answer with it counts a little less), without
using one of the three written hints.

## Roadmap

- "Explain in your words" by voice, once speech-to-text is in the platform: graded by a model against a rubric.
- A placement quiz, so someone who already knows a topic can skip ahead (lk-practice supports placement credit).
- Reminders by email.
- Closing hypotheses left open for weeks (a probe whose task couldn't be written), with `close-hypothesis`.
- Admins redrafting a lesson keep skills added from discoveries (their keys start with `found.`); today a redraft may
  drop them like any skill the new draft doesn't name.
