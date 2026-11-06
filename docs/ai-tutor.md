# The AI tutor (milestone 9)

A tutor in the lab, beside the learner's notebook. It helps them reach the lesson's objectives at their own pace,
finds the exact micro-step where they are stuck, clears a missing prerequisite on the way, and remembers each
learner across sessions. This document is the design: how it teaches, the system prompt, and the harness around it.

Status: **draft for review** (decisions from the interview of 2026-11-05; open points at the end).

## How it teaches

### Decisions

| Topic | Decision |
|---|---|
| Help style | A switch in the panel, remembered per learner: **Guide me** (default) or **Show me**. |
| First move | Always restate the task more clearly, before any hint. The block is sometimes the instructions, not the learner. |
| Show me | **Earned**: on a given step, only after the learner has had the guided hints for it. |
| Errors and ❌ checks | **Explain this error** says what it means and where to look, without the fix. **Suggest a fix** shows a diff the learner reviews and applies. |
| Context | Current cell and output, the whole notebook, the lesson's objectives and 💡 hints, the hidden reference solution, the course outline and where the learner is in it. |
| Micro-steps | Generated live: the tutor breaks the current objective into tiny ordered steps and their micro-prerequisites. Steps written in the course repo can replace this later. |
| Blockers | **Detour**: pause, clear the missing prerequisite (explain, demonstrate, the learner proves it with a small challenge), offer a review, resume where the task stopped. |
| Memory | Our own table in Postgres: dated facts about the learner, superseded when they change. Zep can replace it later behind the same interface. |
| Proactive | Never speaks first. Only the panel and the two error buttons. |
| Tone | Adapts to the learner: starts as a patient senior engineer, then follows the preferences it remembers. |
| Language | The learner's language (Spanish or English); code, APIs and technical terms stay in English, as in the course. |
| Model and cost | The free Gemini models first (`gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`), then DeepSeek V4.1 Flash (`deepseek-flash`, paid, capped at 200 requests a day); every request in a ledger. Admins can choose the model the chain starts at, from the panel. |

### A help request, step by step

1. **Locate.** Which lesson, which objective, which cell; what the learner has run and what came out.
2. **Restate.** One or two sentences: what this cell asks for, in plain words, and what "done" looks like (usually
   the acceptance check printing ✅).
3. **Decompose.** The objective as an ordered list of micro-steps, each one action a learner can check
   (see the Groq example below), and for each step the micro-prerequisites it relies on.
4. **Diagnose.** The first step the learner's code or output does not satisfy, and why:
   - the instructions were unclear (fix: the restatement was the help);
   - the step itself (fix: a hint on that step);
   - a missing prerequisite (fix: a detour).
5. **Help at that step only**, per the mode.

The Groq call from Lesson 00.05, as micro-steps:

1. Import `os` (to read environment variables) and `ChatGroq` from `langchain_groq`.
2. Read the key: `api_key = os.environ.get("GROQ_API_KEY")`.
3. Check it with `if not api_key:` print a "⏭️ Skipped" message; `else:` run steps 4 to 7.
4. Create `llm = ChatGroq(model=..., temperature=0, max_retries=2, timeout=60)`.
5. Build `messages` as `("system", ...)` and `("human", ...)` tuples.
6. Send it: `response = llm.invoke(messages)`.
7. Print `response.content`.

Micro-prerequisites behind them: importing a module, reading an environment variable, `if`/`else`, calling a
constructor with keyword arguments, tuples in a list, calling a method and keeping its result, attributes.

### Guide me and Show me

Guided hints on a step, one level at a time, each only when the learner asks for more:

1. **Goal**: what this step must achieve.
2. **Pointer**: the API, the docs page from the lesson's 📚 Official reading, or the earlier lesson that covers it.
3. **Partial**: a fragment with the learner's part left as a blank, or the same idea on a different example.

**Show me** for a step unlocks once levels 1 to 3 have been given for it. It gives that step's code with an
explanation of each line, never the whole exercise at once.

Research checkpoints stay evidence-based whatever the mode: the tutor points to primary sources and checks the
learner's evidence, and never writes the answer (the course's own rule).

### The detour

When the diagnosis is a missing prerequisite (the learner is calling Groq and has forgotten `if`/`else`):

1. **Pause.** Say what is missing and that the main task waits: "Before the call, let's clear `if`/`else`."
2. **Explain** it in a few lines.
3. **Demonstrate** it on a different, tiny example, never on the learner's exercise, so the detour does not hand
   over the answer.
4. **Challenge.** A small task the learner writes and runs themselves; the tutor checks it. If it fails, one more
   hint and another try; after two failed tries, it shows a worked solution to the challenge, then asks for a
   similar one.
5. **Offer a review.** When a detour closes, the panel shows a "Practise this in a few days" button for its skill;
   one click records it for the practice engine (milestone 10), with no model call. A learner who asks in words
   gets the same through the `request_review` action.
6. **Resume** exactly where the main task stopped: restate the step and continue.

Detours stack (a detour inside a detour), at most two deep; the learner can skip one ("I know this, it was a
slip"), and the tutor records the skip rather than insisting.

## The system prompt (draft)

The stable part, sent first on every call so the provider can cache it. The parts in `{braces}` are filled per
call by the harness.

```text
You are the tutor in Academia del Código's lab, working beside a learner's Jupyter notebook in the course
"{course_title}". Your job is to help this learner reach the current lesson's objectives themselves, at their
own pace. Understanding beats speed: a learner who copies an answer has not learned it.

HOW YOU HELP
1. Always start by restating the task in one or two plain sentences: what the cell asks for and what "done"
   looks like. Unclear instructions are often the real block.
2. Break the current objective into small ordered micro-steps, each a single action the learner can check, and
   note the micro-prerequisites each step relies on (for example: reading an environment variable, if/else,
   keyword arguments). Do this even when the lesson does not list them.
3. Find the first micro-step the learner's code or output does not satisfy. Help with that step only.
4. Mode is "{mode}".
   - guide: give one hint level at a time, and only go further when asked: (1) the goal of the step,
     (2) a pointer to the API, the lesson's official reading or an earlier lesson, (3) a partial fragment with
     the learner's part left blank. Never write the learner's solution.
   - show: allowed only for steps where levels 1-3 were already given (the harness tells you which). Give that
     step's code and explain each line. Never the whole exercise at once.
5. If the block is a missing prerequisite, take a detour: say the main task waits, explain the concept briefly,
   demonstrate it on a different tiny example (never on the learner's exercise), then give a small challenge the
   learner writes and runs. Check their answer. When they pass, offer to schedule practice on it, then resume
   the main task exactly where it stopped. Use the detour tools to record each stage.

ERRORS AND CHECKS
- "Explain this error": say what the error means and where to look (the line, the API, the docs). Do not write
  the fix.
- "Suggest a fix": propose the smallest change that fixes the error as a diff, with one sentence on why. If the
  fix would amount to solving the exercise, fall back to guide mode for that step.

COURSE RULES YOU KEEP
- Hints are goals, not code, unless the mode allows code for that step.
- Research checkpoints need evidence from primary sources (official docs, API reference, source code, release
  notes). Point to sources and check the learner's evidence; never write the answer.
- Never print, repeat or ask for API keys or other secrets, even if they appear in the notebook or its output.
- Do not invent APIs. If you are not sure a function or parameter exists in the version the course uses, say so
  and point to the docs.
- You can see the reference solution. It is confidential: use it to know where the learner is heading, never
  quote it unless the learner is in show mode for that step.

STYLE
- Answer in the learner's language ({learner_language}); keep code, API names and technical terms in English.
- Default voice: a patient senior engineer. Concise, precise, explains the why, no filler, no emoji. Adjust to
  what you know about this learner (below).
- Short answers. One step, one idea at a time. End with what the learner should try next.

WHAT YOU KNOW ABOUT THIS LEARNER
{learner_memory}
```

The rest of each call, after the stable part:

| Section | Contents |
|---|---|
| Course map | The module and lesson titles, which lessons the learner has completed, the current lesson's position |
| Lesson | Objectives, 📚 official reading table, the 💡 hints of the current section, the exercise text |
| Reference solution | The matching part of `solutions/`, marked confidential |
| Notebook | The current cell and its output in full; earlier cells summarised to what they define and import |
| Session state | Mode; the goal stack (main task and any detours); hint levels already given per step |
| Learner message | What the learner asked, or which button they pressed |

## The harness

### Where it runs

| Part | What | Why |
|---|---|---|
| JupyterLab panel | The side panel (chat, mode switch, goal stack shown as breadcrumbs) and the two buttons on errors and ❌ checks | Lives beside the notebook; reads cells and outputs through JupyterLab's APIs |
| Server extension (`infra/lab/tutor`, Python) | In each learner's Jupyter server: `/academia-tutor/{turn,session,mode,practice}` | The panel calls the lab's own address, behind Jupyter's login; the extension adds the hidden solution (`solutions/<name>-solution.ipynb`), turns the path into the course's, and forwards with the token JupyterHub gave this server |
| Learning service (`services/learning`, Node 24) | A container beside the hub (`infra/lab/compose.yaml`, service `learning`), on the lab's private network only | Asks the hub whose token it was handed (`GET /hub/api/user`), so a learner can only be themselves; holds the model keys; long-lived state for `lk-practice` later |
| Platform database | New tables in the same Postgres: tutor sessions, messages, learner memory, practice requests, the ledger | One source of truth with the platform's progress, enrollments and AI logs |
| Models | The free Gemini models, then DeepSeek (`lib/ai/gemini.ts` `TUTOR_CHAIN`), with structured logs like the platform's AI calls | Free first; a paid fallback in the same class as Gemini 3.8 Flash |

The plan was first to register the service with JupyterHub at `/services/learning`. A server extension does the
same job with no OAuth code in the service: it is how Jupyter's own AI tools reach their backends.

### One request per turn: actions in a JSON reply

The free tier allows 20 requests a day on `gemini-3.6-flash`, so each learner turn is exactly one request.
Function calling would cost two: a model that calls functions stops to wait for their results. Instead the model
answers with one JSON object, enforced by a response schema (`lib/tutor/tools.ts`): `actions`, what it records
about the turn, first (it plans before it writes), then `reply`, what the learner reads. The harness, not the
model, owns the state (`lib/tutor/state.ts`) and refuses actions that break the rules (a hint level skipped, a
third nested detour, a step that doesn't exist); refusals are logged as `tutor.refused`.

| Action | Effect |
|---|---|
| `set_steps {objective, steps[]}` | Records the micro-steps for the current objective (re-planning the same objective keeps its hint levels) |
| `mark_step {step, status}` | Where the learner is (`todo`, `stuck`, `done`) |
| `give_hint {step, level}` | A hint level given, one level up at a time; Show me unlocks for a step at level 3 |
| `start_detour`, `detour_challenge`, `detour_attempt`, `end_detour` | The detour stages, pushed and popped on the goal stack (two deep at most); closing one makes the panel offer practice |
| `request_review {skill, evidence}` | The learner asked in words for practice: queued for the practice engine |
| `remember {kind, subject, fact, skill?}` | A learner fact: `preference`, `misconception`, `strength` or `struggle`; supersedes an older fact on the same subject |

### Data

| Table | Holds |
|---|---|
| `tutor_session` | Learner, lesson, notebook path, mode, goal stack, hint levels per step, started/ended |
| `tutor_message` | Each turn, with the model, tokens, cost and trace id |
| `learner_memory` | Facts: kind, text, skill, source session, `valid_from`, `superseded_at` |
| `practice_request` | Skill, evidence (detour passed or skipped), requested at; read by milestone 10 |
| `ai_spend` | The ledger: learner, day, tokens, cost; the daily budget is checked before each call |

### Budget

Two audiences, two limits, both settings rather than code:

| Who | Limit | Why |
|---|---|---|
| **Lab learners** (the tutor) | Per model, the requests a day the **Gemini free tier** allows: the primary model until its daily count, then the fallback model until its count, then the tutor pauses until the reset | Keeps the paid key's daily use at what a free project could do, so the tutor costs as little as possible |
| **Everyone else** (the platform's AI features, such as challenges) | A small daily request count per learner | Those features are not the course; nobody uses them yet |

- The day resets at **midnight Pacific time**, as Google's daily quotas do, so our count and Google's line up.
- Every call is still priced at the paid rates and written to the ledger (`ai_spend`). The key is Tier 2, so
  calls under the free-tier count are not free: the cap bounds the cost, it does not remove it.
- At the limit, the panel says so, says when it resets, and offers the course's 💡 hints and docs instead.

Prices on the paid tier (Google's pricing page, checked 2026-11-05):

| Model | Input / output per 1M tokens |
|---|---|
| `gemini-3.6-flash` | $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50 |
| `gemini-3.1-flash-lite` | $0.25 / $1.50 |

The free-tier counts are no longer published in Google's docs; they are shown only in AI Studio's Rate limit page.
Third-party reports say 20 requests a day (5 a minute) for `gemini-3.6-flash`; unconfirmed, so the values come
from AI Studio before this is built.

## Built so far

| Part | Where | Status |
|---|---|---|
| Free-tier quota and ledger for every Gemini call (tutor and platform) | `lib/ai/quota.ts`, `lib/ai/gemini.ts`, table `ai_request` | Deployed 2026-11-06 |
| Tutor tables | migration `add_ai_tutor` | Deployed 2026-11-06 |
| Tutor core: prompt, context, actions, state rules, memory, practice | `lib/tutor/` | Built and tried against Gemini locally (below) |
| Gemini 3.8 Flash first, DeepSeek V4.1 Flash as the tutor's last fallback | `lib/ai/gemini.ts`, `lib/ai/deepseek.ts` | Deployed 2026-11-06 |
| Learning service | `services/learning`, `infra/lab/learning`, `pnpm learning:build` | Deployed 2026-11-06 on the lab server |
| Server extension | `infra/lab/tutor`, installed by the student image (`infra/lab/Dockerfile`) | Deployed 2026-11-06 (image `lab-lc-mastery:2026-11-06`) |
| JupyterLab panel and buttons | `infra/lab/tutor/labextension`, built inside the student image | Deployed 2026-11-06; answered in the production lab |
| Model choice for admins | the panel's Model list; `chainStartingAt` in `lib/ai/gemini.ts`; `lib/tutor/harness.ts` | Built and tried in a local lab (below) |

**Choosing the model (admins).** A platform admin (the hub's `lab-admin`) gets a Model list under Guide me / Show me:
"Automatic (waterfall)", the chain as it is, or a model to start at. The chain then starts at that model, goes on with
the ones after it, then wraps to the ones before it: choosing Gemini 3.6 Flash tries 3.6 Flash, both Flash-Lite
models, DeepSeek, then 3.8 Flash; choosing DeepSeek falls back to the free models from the top. The chosen model is
tried even while it cools down, since that is what was asked. Each reply then names the model that wrote it, and the
chosen one when it didn't answer ("Gemini 3.1 Flash-Lite (instead of Gemini 3.6 Flash)"). The choice is kept per
browser (`localStorage`), and the service ignores it from anyone who isn't an admin, so learners can't move their
turns to the paid model.

Tried on 2026-11-06 in a local lab with lesson 00.01: the list showed the five models; choosing Gemini 3.6 Flash
(whose request failed) answered with 3.1 Flash-Lite and said so; the choice survived a reload; an enrolled learner
who sent a model got the chain as it is and no list.

**Gemini 3.8 Flash on the free tier.** On 2026-11-06 it didn't answer at all for hours: a three-word prompt got no
reply in 90 s, whatever the thinking level, so lowering the tutor's thinking would not help. It also refuses the
MINIMAL thinking level the platform's other AI features ask for (400 "Thinking level MINIMAL is not supported"),
which failed every one of their calls on it; the chain now sends it LOW instead (`minThinking`). After a timeout a
model is skipped for 30 minutes (a refusal, 429 or 5xx: five minutes), so a learner pays the wait at most once per
half hour. The free daily count is per Google project, while each database keeps its own ledger: local trials spend
production's allowance (3.6 Flash's 20 requests were gone by 02:00 UTC), and Google's 429 then moves the chain on.

Tried in the browser on 2026-11-06, in a lab container from the student image with lesson 00.05: the panel sits in the
right sidebar; running a cell with a missing colon brought up "Explain this error" and "Suggest a fix"; the reply
filled the objective and micro-steps (the stuck step highlighted) and explained without the fix; Guide me / Show me
saved the choice; reloading restored the conversation, steps and mode. What the trial changed:

- **The harness decides Show me, per step.** A lighter model in Show me gave a step's code before its hints. The
  context now states the mode that applies: Show me only for unlocked steps, otherwise Guide with a one-sentence
  reason. Asked again for a locked step, the tutor said Show me opens after the three hints, and guided.
- **The harness decides the reply language.** After English messages, a lighter model kept answering in English to a
  Spanish question. The learner's words now decide (accents and common words), and the turn says "[Reply in
  Spanish.]"; a button press uses the platform language.
- **A slow model is skipped for a while.** `gemini-3.8-flash`, when overloaded, hangs until the 12 s timeout
  instead of refusing; after a timeout, a 429 or a 5xx, the chain skips that model (now 30 minutes after a timeout,
  five after a refusal).
- When both Flash models are spent or busy, `gemini-3.1-flash-lite` answers: it needs the rules stated plainly per
  turn, which is why the two decisions above moved into the harness.

Tried on 2026-11-06: the service refuses no token and an unknown token (401) and recognises a learner's hub token;
inside the student image the extension loaded, refused calls without Jupyter's login (403), found the project's
reference solution (27,032 characters), refused a path outside the work folder, and carried a real tutor turn
through to Gemini (the tutor's steps came from the hidden solution); the service's own image ran on the lab
network, reached the hub, and read the database.

Tried on 2026-11-05 with lesson 00.05 and a learner whose `if` lacked its colon: "Explain this error" restated the
task and explained the error without the fix; a question about if/else started a detour with its own example and a
challenge; the passed challenge closed the detour, offered practice and resumed the main task; a stated preference
was saved to memory. About 3 to 5 seconds a turn, about 6,500 input tokens, about US$0.005 a turn at paid rates.
What the trial changed: tools became actions in one JSON reply (function calls left replies empty), the practice
offer became a button (the model skipped asking), memory rules got examples, and Guide-mode examples must use a
different situation from the exercise (a learner's "examples first" preference had produced their answer).

## Open points for review

Decided on 2026-11-05: Show me unlocks after hint level 3; detours two deep; a "What the tutor knows about me"
view where learners can delete facts; the learning service on the server, behind the hub.

1. **The free-tier daily counts** for `gemini-3.6-flash` and `gemini-3.1-flash-lite`, read from AI Studio's Rate
   limit page, to set the lab limit.
2. **The daily count for everyone else** (the platform's AI features outside the lab).
