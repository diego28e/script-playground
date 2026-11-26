# How the whiteboard teacher teaches (spec)

2026-11-26. The requirements for Didactra's teacher in platform lessons, agreed with you in an interview after a test
lesson with Qwen4-Max (lesson `cc8c16ce0cab`). Both projects build against this page:

- **Didactra** (`16-didactra`) builds the teaching, the opening, the checklist, the models and the voice;
- **the platform** (this repo) builds the preferences, the "How I learn" page and its side of the contract.

It follows `docs/teaching-method.md` and extends `docs/whiteboard-contract.md`.

## 1. What went wrong (Fact, from the lesson's transcript and Didactra's code)

- **The opening asked "Where would you like to start?"** It's a fixed sentence (`phrases.hello` in
  `apps/agent/src/tutor/phrases.ts`), spoken before the model writes anything. A teacher knows what it is teaching.
- **One turn held a whole lesson:** about 15 sentences, ten drawings.
  - The prompt's pacing rule applies only "when the learner asks to go at their pace". There is no default, and "stop
    when you have answered" doesn't apply when the teacher leads.
  - The turn asked the learner to create `tsconfig.json`, then described the error they would get without waiting
    for them to do it. No rule covers a hands-on step.
- **A preference stood in for a principle:** it saved "Start the lesson and lead; Diego listens and interacts", which
  a model can read as licence for a monologue.

## 2. Three layers

### Fixed principles: in code, the same for every learner, no preference changes them

1. **The teacher leads the content.** It never asks what the learner wants to learn or practise.
2. **It opens with the lesson** (section 3): what the skill is for, what the learner will be able to *do*, the
   checklist, then "Ready?".
3. **A question gets a full answer at once.** No putting it off, no withholding.
4. **It never describes the result of a step the learner hasn't done.** After asking them to do something, it asks
   what they saw, and builds on that.
5. **Misconceptions are corrected plainly and at once.**
6. **Outputs come from real runs.** Nothing is used before it's taught.
7. **A checklist item is ticked only on evidence:** the learner did it, or explained it in their own words. Being told
   is not evidence. An item the learner unticks is gone back over (section 3).

Items 3 and 5 are already the platform's voice teachers' rules (`lib/voice/teaching.ts`). The others are the board's.

### Defaults: in code, a preference can change them

- **One idea or one step per turn while leading**, then the turn goes back to the learner.
- **Hand-backs are light by default:**
  - a short "Shall we go on?", or simply stopping after a step;
  - a real check (predict what this prints, apply it to a new case) only after something hard, before building on
    it, or after a long passive stretch;
  - never "Does that make sense?" as the check.
- **Wait after each hands-on step** until the learner says what happened. A learner can ask it to keep going ("I'll do
  the steps later"). Then it goes on, still never describing a result as theirs (principle 4).
- **Predict before running code on the board:** before stepping through a trace, it asks what the code will print or
  do. "Just show me" becomes a preference.
- **Practical first; theory when asked**, or when a preference says so.

### Preferences: per learner, explicit, word for word

| Scope | What it is about | Examples | Read by |
|---|---|---|---|
| `all` | How they like to be taught | "Go in small steps", "examples from AWS", "short answers", "theory first" | Voice teachers, the practice coach, the board |
| `board` | The board itself: drawing, traces, spaces, arrows | "Draw a diagram before you explain", "let me type the code in the trace myself" | Only Didactra |

- **A new table on the platform**, separate from the profile notes. Lines are kept word for word: never rewritten,
  summarised or merged by a model.
- **Didactra saves with a scope:** `remember all "…"`, `remember board "…"`, `forget "…"`. The rule given to the model:
  anything about drawing, the board, traces, spaces or arrows is `board`; anything about how the learner likes to be
  taught is `all`. When a new line contradicts an older one, it forgets the older one.
- **The platform files board lines itself.** A line saved as `all` that mentions the board, a whiteboard, drawing, a
  diagram, a trace or a space is stored as `board`, so a voice teacher never receives an instruction about a board it
  doesn't have. The model's scope is a hint; the platform has the last word.
- **The profile notes stay as they are.** They are what the platform has *observed*: what works, misconceptions, what
  they know well. They're written from conversations and board summaries. When an explicit preference and an
  observation disagree, the preference wins, in every teacher's prompt.
- **Nothing a preference says overrides a fixed principle.** "Just tell me everything at once" changes the turn size
  (a default). "Don't explain, only quiz me" can't stop a question getting a full answer.
- **No preferences form.** Preferences come from what the learner says while learning, as today. The fixed principles
  and defaults are what make the first board work well without any setup.

## 3. A lesson on the board

1. **Opening.** An instant "Hi Diego." (no silence while the model writes), then the model's first turn:
   - what the skill is for, in one real situation;
   - what the learner will be able to *do* by the end: 2 to 4 concrete, checkable items in plain words ("run a `.ts`
     file and read its type errors", not "understand TypeScript");
   - those items drawn as the board's first space, the **checklist**;
   - "Ready to start?".

   It's pitched to what the platform says about the learner: new, learning or reviewing; what they got wrong in
   practice; earlier boards on this skill. Questions about the objectives are answered before starting.
2. **Leading:** one idea or step per turn (the defaults above), building on the board, predicting before runs.
3. **Hands-on steps** end the turn. The teacher waits, then works from what the learner reports.
4. **The checklist:**
   - **Ticking:** the teacher ticks an item when the learner has shown it, and says so briefly.
   - **Unticking:** the learner can untick any item, ticked by the teacher or not. Didactra tells the teacher (as one
     of the learner's events). The teacher acknowledges it at once and offers to go back over that part. The item
     counts as hard in the summary.
5. **Resuming a board:** "Welcome back", where they were, what's still unticked, then "Shall we go on?".
6. **Ending:** when every item is ticked, the teacher:
   - recaps against the checklist;
   - asks the learner to say in their own words, or show, one thing they can now do;
   - suggests **End the lesson**.

   The learner presses it, or keeps going. The teacher never ends the board itself.

## 4. Models

- **Learners can switch** on the board between Claude Sonnet 5.5 (**the default**), Qwen4-Max, Claude Haiku 5.5, and
  DeepSeek V4 Pro or V4.1 Flash.
- **DeepSeek with reasoning off.** Verified by the Didactra session on 2026-11-26 against DeepSeek's own Anthropic API
  docs (`api-docs.deepseek.com/guides/anthropic_api`): `thinking: {"type": "disabled"}` works for both
  `deepseek-flash` (V4.1 Flash) and `deepseek-v4-pro`, directly through `api.deepseek.com/anthropic`, with no
  DolphinGo needed. Both are candidates, pending section 6's checks. DeepSeek has peak and off-peak prices, and
  Didactra reports each call at the price for its time.
- **Claude Opus 5.5 is admins only.**
- **Each model on the learners' list must pass the checks** (section 6). A model that doesn't stays admin-only until it
  does.

## 5. Voice: ElevenLabs

- **The default voice:** ElevenLabs **Eleven v4 Turbo** (`eleven_v4_turbo`), voice **Chris** (`NMxp5bnMnB1sL7oen8GM`),
  for both languages.
  - Checked with ElevenLabs' API on 2026-11-26: the model is half Eleven v4's credits per character and speaks
    Spanish. Chris is "Charming, Down-to-Earth", conversational.
  - Chris is already one of the platform's lesson-audio narrators.
- **LiveKit's ElevenLabs plugin for Node agents** (1.10.1, the same as Didactra's agents), with its word timings
  (`syncAlignment`), so drawings land on the words they belong to. It streams `eleven_v4_turbo` through ElevenLabs'
  text-to-dialogue API. It reads its key from `ELEVEN_API_KEY`, so that is the name in Didactra's `.env`.
- **Its own ElevenLabs key** (for example `academia-whiteboard`), with a monthly credit cap. Admin → Spend then shows
  it as its own key instead of flagging it.
- **Pocket TTS is the fallback** when ElevenLabs fails or the credits run out: the same sentence, no gap. The agents
  SDK's TTS `FallbackAdapter` does it.
- **The acknowledgment clips** ("Okay.") are made again in Chris's voice.
- **Learners can still pick** Pocket TTS or Deepgram Flux on the board.

## 6. Checks (before learners get any of this)

Scripted conversations through Didactra's real pipeline, on every model offered to learners. They're scored by
deterministic checks where possible, a model judge with a written rubric otherwise. Each scenario has a development
set, plus a held-out set frozen before the run.

| Scenario | Passes when |
|---|---|
| A new board, the learner says nothing special | It opens with the skill's purpose, 2 to 4 concrete outcomes drawn as a checklist, and "Ready?". It never asks what they want to learn. |
| "Go ahead, you lead" | At most one idea or step per turn; each turn ends handing back. Sentences per turn are counted. |
| A hands-on step | The turn ends after the step; no result described before the learner reports it. |
| A quick question mid-lesson | A full answer, short; then back to the lesson. |
| Before a trace runs | It asks for a prediction (unless the learner said "just show me"). |
| The learner unticks an item | It acknowledges it and offers to go back over it, in that turn. |
| All items ticked | Recap, one "show me", then it suggests End the lesson. |
| A board preference | Saved as `board`; never reaches a voice teacher's context. |
| "Keep going, I'll do it later" | It stops waiting at hands-on steps, and still never describes a result as theirs. |

Results are recorded with the date, the model and the cost. The test lesson `cc8c16ce0cab` becomes a regression case.

## 7. Who builds what

**Didactra (its repo):**
- the prompt's three layers, and scoped `remember` and `forget`;
- the opening (instant hello, then the model's turn); the resume;
- the checklist on the board, its ticking and unticking, and the untick event to the teacher;
- the ending;
- the learners' model list, with DeepSeek verified first;
- ElevenLabs as the voice, its key, the fallback and the clips;
- the checks of section 6;
- dropping the old fixed hello and the "Start the lesson and lead" line;
- on a phone (section 8): the exit button while in full screen and its messages, and panels that close easily.

**The platform (this repo):**
- the preferences table, with its two scopes and the guard that files board lines as `board`;
- one **How I learn** page: the preferences in two groups, and the observations, each removable. The voice teacher's
  panel and the board link to it.
- the voice teachers reading the `all` preferences, and the "preference wins over observation" rule;
- the contract's additions (below), and showing each checklist item's outcome in the lesson panel's "What the board
  found";
- full screen on the board page: the button to go in, the frame's messages, the layout, the Fullscreen API, Back.

**The contract (`docs/whiteboard-contract.md`), agreed before either side builds:**
- the context gains `preferences: { all: [{ id, text }], board: [{ id, text }] }`;
- a new `preference` event: `{ action: "remember" | "forget", scope, text, id? }`. The platform answers with the
  line's id and the scope it was filed under.
- the `ended` summary gains `objectives: [{ text, met, untickedByLearner }]`. Practice treats an unticked item as
  something the learner found hard.
- the frame's messages for full screen (§4).

All written into `docs/whiteboard-contract.md` on 2026-11-26.

## 8. On a phone (your request, 2026-11-26)

- **Full screen:** the platform's bar has the button to go in. The board then fills the screen, and the site's header
  and the bar step aside. While in, Didactra's toolbar shows the button to leave (`docs/whiteboard-contract.md` §4).
  Back and Escape leave too. Outside the platform, Didactra's own button uses the browser's Fullscreen API.
- **Settings panels close easily.** Every panel the board opens on a phone (model, voice, "How I learn", transcript,
  export, and any other) closes in any of these ways:
  - a close button of at least 44 × 44 px, always visible at its top;
  - a tap outside it;
  - a swipe down, where it slides up as a sheet;
  - the browser's Back;
  - Escape on a keyboard.

  Only one panel is open at a time. None covers the talk button, so the learner can always speak or stop the teacher.
- **Checked** at 375 × 812 (an iPhone's size) and 412 × 915 (an Android's), in both orientations:
  - no sideways scroll;
  - the board, the talk button and the full-screen button reachable;
  - every panel closes each of those ways.

## 9. Not in this round

- A preferences form (decided against).
- The voice teachers saving preferences themselves: they read them for now.
- Fading by profile (shorter worked examples as knowledge grows) and the hint ladder: `docs/teaching-method.md` §10.
