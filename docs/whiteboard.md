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

- `pnpm board:check` (`scripts/board-check.ts`): the tokens, signed and refused; the events Didactra may send; how a
  practice state and a summary are told to the teacher. No database, no model.
- End to end: the board page with Didactra running on your PC (`BOARD_URL=http://localhost:4330`).
