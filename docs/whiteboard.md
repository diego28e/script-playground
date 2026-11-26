# The whiteboard

Learning a lesson's skills with Didactra (`16-didactra`), a teacher that talks with the learner and draws on a
whiteboard as it explains: diagrams, tables, code it runs step by step, marks on what it's talking about. It knows the
skill being learned, the lesson that teaches it, the learner's profile, and how their practice on it went.

- The plan and its decisions: `docs/whiteboard-plan.md`.
- What the platform and Didactra say to each other: `docs/whiteboard-contract.md`.

## How it works

- **A board per skill.** On a lesson page, **Learn on the whiteboard** lists the lesson's skills (once its practice
  draft is approved), each with the learner's state (`new`, `learning`, `reviewing`, `secure`, read from lk-practice's
  state) and **Open** or **Continue**. The first skill not yet secure is marked **Next**. A lesson whose skills aren't
  approved yet gets one board for the whole lesson.
- **Done on the board.** A skill whose board the teacher finished (ended with its summary) shows "Done on the board ·
  date" beside its practice state. Pressed, it opens what that board found: how long, what was explained, what the
  learner showed, what was hard, and, when ready to practise, a link to practice; and "See the board" opens that
  session's replay and transcript. The practice state stays practice's own: the mark never changes it.
- **The board page** (`/courses/<course>/<module>/<lesson>/board`):
  - Didactra fills the screen under a bar with the lesson, a skill switcher and **New board**.
  - `?skill=` opens that skill's open session, or a new one. `?session=` opens one of the learner's own sessions.
    Neither opens the next skill.
  - The page's language (the `adc_lang` cookie) is the session's; a session follows a language change.
- **Sessions** (`BoardSession`): one learner, one skill (`skillKey`) or one lesson (`skillKey` null).
  - The newest open one is resumed.
  - **New board** closes it, kept with its history, and starts another.
  - Didactra keeps the board, the transcript and the replay. The platform keeps who, what, when, the minutes, the cost,
    the model and voice, and the summary.
- **The launch** (`lib/board/token.ts`): the board page signs a token valid 60 s for the session (`BOARD_SECRET`) and
  frames `BOARD_URL/launch?t=…` with the microphone allowed. Didactra checks it and keeps the learner in a cookie of its
  own.
- **The context** (`GET /api/board/sessions/<sid>/context`, `lib/board/context.ts`): Didactra's server asks what to
  teach:
  - the skill, its prerequisites and what comes after, with the learner's state in each;
  - the lesson's text, up to 12,000 characters, and its objectives;
  - the learner's profile;
  - their last 5 practice answers on the skill;
  - what the last 3 boards on it found.
- **The events** (`POST /api/board/sessions/<sid>/events`, `lib/board/events.ts`):
  - `started` binds Didactra's session id.
  - `usage` updates the minutes and cost, every 10 minutes or so and when a Didactra job closes (a reload or a dropped
    connection; the same board comes back).
  - `ended` comes when the learner presses **End the lesson** on the board, or after 2 hours without a connection. It
    stores the summary. Then:
    - **ready to practise:** the skill goes first in the learner's practice, the way the lab tutor's practice requests
      do (a `PracticeRequest` already resolved to the skill). It's never marked mastered: practice decides that.
    - **the summary joins the learner profile** (`learnFromBoardSummary` in `lib/voice/profile.ts`), after the answer
      (`after()`), so the voice teachers and the coach know what the board found.
  - Each event's id is kept (`BoardSessionEvent`), so one sent again is applied once.
- **Spend:** Admin → Spend has a **Whiteboard** section: the month's sessions by learner, with Didactra's minutes and
  cost. Didactra uses the platform's Deepgram project and tags every call: `adc-whiteboard-listen` and
  `adc-whiteboard-speak` in platform lessons, `adc-whiteboard-dev` for its development and tests. They're counted by
  workload and never flagged as unknown.

- **How the teacher teaches:** `docs/whiteboard-teaching.md`. Fixed principles, defaults, and the learner's own
  preferences. The opening with its checklist. One step at a time, and the ending.
- **Preferences** (`lib/preferences.ts`, table `learner_preference`): the learner's own instructions for how to teach
  them, word for word, never rewritten by a model.
  - `all`: read by every teacher. The voice teachers get them above their observed notes (`lib/voice/context.ts`,
    "How this learner asked to be taught").
  - `board`: read only by the whiteboard.
  - **Where they come from:** Didactra sends them as `preference` events. The learner can also add or remove them on
    **How I learn** (`/how-i-learn`, in the account menu and linked from the voice sheet).
  - **Board lines stay on the board:** a line about drawing, the board, a diagram, a trace or a space is filed as
    `board` whatever scope it came with (`fileScope`), so a voice teacher never gets one.
  - **How I learn** also shows what the teachers observed (the profile's notes), which the learner can forget.
- **The checklist's outcomes:** the `ended` summary carries `objectives`. "What the board found" shows each one as done
  or not yet, marking the ones the learner unticked. An unticked one counts as something they found hard, in their
  profile.
- **Full screen** (`components/courses/board-fullscreen.ts`, contract §4): the bar's button fills the window with the
  board, over the site's header. The Fullscreen API is used where the browser has it; on an iPhone, the layout alone
  does it. Didactra's page shows the way out. Back and Escape leave too.

## Who sees it

Admins only for now (`boardAllowed` in `lib/board/offer.ts`), and only where `BOARD_URL` and `BOARD_SECRET` are set.
Opening it to learners (a course switch, a model allowance per learner) is the next step once you've used it.

## Setting it up

| Where | Variable | Value |
|---|---|---|
| Amplify (production) | `BOARD_URL` | `https://board.academiadelcodigo.com` |
| Amplify (production) | `BOARD_SECRET` | 32 or more random bytes, base64url. The same value in Didactra's `.env` on the server. |
| `.env.local` (development) | `BOARD_URL` | `http://localhost:4330`, Didactra's page on your PC |
| `.env.local` (development) | `BOARD_SECRET` | a development value of its own, also in Didactra's local `.env` |

The tables come with the migration `20261126120000_board_sessions`.

## Checking it

- `pnpm board:check` (`scripts/board-check.ts`), with no database and no model:
  - the tokens, signed and refused;
  - the events Didactra may send, preferences and objectives included;
  - how a practice state and a summary are told to the teacher;
  - which preference lines are the board's;
  - where the voice teachers read the preferences.
- End to end: the board page with Didactra running on your PC (`BOARD_URL=http://localhost:4330`).
