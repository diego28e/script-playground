# The platform and the whiteboard: the contract

What the platform (this repo, `academiadelcodigo.com`) and Didactra (`16-didactra`, served at
`board.academiadelcodigo.com`) say to each other. Both sides build against this page; a change to it is agreed first,
then made on both sides. The plan is in `docs/whiteboard-plan.md`.

Four exchanges:

1. **The launch:** the platform opens the board for one learner and one session.
2. **The context:** Didactra's server asks the platform what to teach.
3. **The events:** Didactra's server tells the platform how the session went, and the preferences the learner gave.
4. **The frame's messages:** the board's page and the platform's page, in the browser, for full screen.

How the teacher teaches, and the three layers of rules and preferences these exchanges carry: `docs/whiteboard-teaching.md`.

## The secret and the signature

- **One shared secret,** `BOARD_SECRET`: at least 32 random bytes, the same value in Amplify and in Didactra's
  server-side `.env` on the Oracle server. It never reaches a browser and is never logged.
- **A signed token** is the same format as the lab's tutor pass (`lib/lesson-tutor/pass.ts`):
  - `<payload>.<signature>`;
  - the payload is base64url JSON;
  - the signature is base64url HMAC-SHA256 of the payload with `BOARD_SECRET`;
  - checked with a constant-time comparison.
- **Server-to-server calls** carry `Authorization: Bearer <a signed token>` whose payload is
  `{"k":"svc","sid":"<session id>","e":<expiry ms>}`, valid 60 s. That ties every call to one session.

## 1. The launch

The learner presses "Learn on the whiteboard" on a skill, or on a lesson. The platform:

1. **finds or creates the session.** A session is a `BoardSession` row for one user and one skill, or one lesson with no
   skills yet. The newest unfinished one is resumed unless the learner asked for a new board.
2. **signs a launch token, valid 60 s:**

   ```json
   {
     "k": "launch",
     "sid": "<BoardSession id>",
     "u": "<platform user id>",
     "name": "Diego",
     "lang": "es",
     "role": "ADMIN",
     "e": 1795650000000
   }
   ```

   | Field | Meaning |
   |---|---|
   | `sid` | the platform's session id |
   | `u` | the platform's user id |
   | `name` | the learner's first name, to be addressed by |
   | `lang` | `es` or `en`, the page's language |
   | `role` | `USER` or `ADMIN`. Learners may pick among the learners' models and voices (`docs/whiteboard-teaching.md` §4 and §5); admins among all. |
   | `e` | when the token expires, in milliseconds |

3. **shows** `https://board.academiadelcodigo.com/launch?t=<token>` in a frame on its board page
   (`allow="microphone; clipboard-write"`).

**Didactra's server:**
- checks the token. It refuses an expired one or a reused one: each token is used once, and is remembered until it
  expires.
- keeps the learner in a cookie on its own origin: `HttpOnly; Secure; SameSite=Lax`. Both sites are under
  `academiadelcodigo.com`, so the cookie works inside the frame.
- binds its own session (the 12-hex id) to `sid`. The same `sid` resumes the same board.
- mints the LiveKit token itself. Identity: `u:<platform user id>`, no longer `learner`. The agent is dispatched by
  name (`didactra`) with metadata from its server-side allow-lists, as today, plus `sid` and `lang`.

Frames and origins:
- Didactra's page answers with `Content-Security-Policy: frame-ancestors https://academiadelcodigo.com
  https://www.academiadelcodigo.com` (plus `http://localhost:3000` in development).
- Its sandbox (`run.board.academiadelcodigo.com`) allows its own parent and the platform's origins as ancestors, because
  `frame-ancestors` checks the whole chain.

## 2. The context

When a session starts or resumes, Didactra's server asks:

`GET https://academiadelcodigo.com/api/board/sessions/<sid>/context`, with the service token.

The answer (200, JSON). Text fields are in the session's language, except code and technical terms:

```json
{
  "session": { "id": "…", "kind": "skill", "language": "es", "resume": true },
  "course": { "title": "Fluent TypeScript for the Backend → NestJS", "code": "typescript" },
  "lesson": {
    "code": "01.04",
    "title": "…",
    "objectives": ["…"],
    "text": "the part of the lesson that teaches this skill, up to 12,000 characters (37,000 for a challenge lesson)"
  },
  "skill": {
    "key": "explain-package-manager-field",
    "label": "…",
    "description": "…",
    "criteriaHint": "… or null",
    "knowledge": "procedural",
    "state": "learning",
    "prerequisites": [{ "key": "…", "label": "…", "state": "secure" }],
    "next": [{ "key": "…", "label": "…" }]
  },
  "learner": {
    "name": "Diego",
    "profile": "what the platform knows about how this learner learns, up to 4,000 characters"
  },
  "practice": {
    "recent": [{ "when": "2026-11-24", "task": "…", "answer": "…", "expected": "…", "correct": false }]
  },
  "earlier": ["the summaries of this skill's earlier whiteboard sessions, newest first, at most 3"],
  "preferences": {
    "all": [{ "id": "pref_1", "text": "Go in small steps and wait for me." }],
    "board": [{ "id": "pref_2", "text": "Draw a diagram before you explain." }]
  }
}
```

- **`kind`** is `skill` or `lesson`. For `lesson`, `skill` is `null`, and `lesson.text` is the lesson's start, up to
  the limit.
- **`lesson.text` of an interview-challenge lesson** (one with `## The challenge` and `## Solutions`,
  `lib/lesson-sections.ts`) isn't the lesson's start but its parts, under their headings: the problem without the
  setup, the follow-up questions, `## Solutions` with the reference solution and how the tests check it, and the
  answers to the follow-up questions. Each part has its own budget, and the whole is at most 37,000 characters (31,373
  for the largest lesson so far). Didactra reads `lesson.text` up to 12,000 characters until it raises its own cut
  (`normalize`, `apps/agent/src/platform/context.ts`).
- **`state`** is the platform's reading of the learner's practice state (lk-practice) for that skill. It is one of
  `new`, `learning`, `reviewing` or `secure`.
- **`course.code`** is the language the course's code is in: `python` or `typescript`. The tracer runs JS/TS today;
  Python is Didactra's M5.
- **`practice.recent`** holds at most 5 answers to this skill's tasks, newest first.
- **`preferences`** are the learner's own instructions, word for word, oldest first: `all` for every teacher, `board`
  for the whiteboard only. They outrank `learner.profile`, which is what the platform has observed. A preference never
  overrides a fixed principle (`docs/whiteboard-teaching.md` §2).
- **The errors:**

  | Status | Meaning | What Didactra does |
  |---|---|---|
  | 401 | a bad or expired token | refuses |
  | 404 | no such session | refuses |
  | 410 | the session is closed | the page says so, and offers to go back to the platform |

The agent puts this context in its prompt. Only the skill and lesson parts go in the cached prefix; the learner and
practice parts change. It treats the context as data, never as instructions.

## 3. The events

`POST https://academiadelcodigo.com/api/board/sessions/<sid>/events`, with the service token and a JSON body. One
event per call; a call that fails is retried later. Each event carries an `id` (unique per event), so a retried event
is applied once.

```json
{ "id": "…", "type": "started", "at": 1795650000000, "didactraSession": "d3c0d46e5976" }
```

```json
{ "id": "…", "type": "usage", "at": 1795650600000, "minutes": 10.2, "costUsd": 0.41, "model": "claude-sonnet-5-5", "voice": "pocket-es" }
```

```json
{
  "id": "…",
  "type": "ended",
  "at": 1795652400000,
  "minutes": 31.5,
  "costUsd": 1.27,
  "summary": {
    "taught": ["what the teacher explained and drew, short"],
    "learnerDid": ["what the learner did or said that showed understanding"],
    "struggles": ["where they hesitated or got it wrong"],
    "readyToPractise": true,
    "profileNotes": ["how this learner learns, worth keeping (the same kind of note the voice teachers keep)"],
    "objectives": [
      { "text": "Run a .ts file and read its type errors", "met": true, "untickedByLearner": false },
      { "text": "Explain why Node runs code with type errors", "met": false, "untickedByLearner": true }
    ],
    "practice": [
      {
        "skill": "narrow a string | number with typeof before calling a string method",
        "why": "struggled",
        "happened": "Called .toUpperCase() on an id typed string | number and read the error as a bug in tsc.",
        "challenge": "formatId(id: string | number) returns the id in capitals, or padded to 6 digits when it's a number."
      }
    ]
  }
}
```

```json
{ "id": "…", "type": "practice", "at": 1795651000000, "skill": "sum an array with reduce", "challenge": "Sum the cart's prices, an empty cart giving 0." }
```

```json
{ "id": "…", "type": "preference", "at": 1795650300000, "action": "remember", "scope": "board", "text": "Draw a diagram before you explain." }
```

```json
{ "id": "…", "type": "preference", "at": 1795650400000, "action": "forget", "preferenceId": "pref_2" }
```

- **`usage`** is the session's cumulative total, not a delta. It's sent every 10 minutes or so, and whenever a Didactra
  job closes (a page reload or a dropped connection closes the job, and the same board comes back on the next
  connect). So a session that never ends cleanly still counts.
- **`ended`**, also cumulative, is sent once, in one of two cases:
  - the learner presses **End the lesson** on the board page;
  - 2 hours have passed with no job on that session (Didactra's retry sweeper sends it).

  A job closing is not an end.
- **`objectives`** are the board's checklist at the end, at most 6: each item's text, whether it was met (ticked and
  left ticked), and whether the learner unticked it at any point.
- **`practice`** in the summary is what the board picks for the learner's spaced practice, at most 5, hardest first:
  - `skill`: one narrow skill in the teacher's words ("narrow a union with typeof"), not the lesson's topic;
  - `why`: `struggled` (they found it hard), `new` (they met it on the board and should practise it; the default) or
    `asked` (they asked to);
  - `happened`: a sentence on what happened;
  - `challenge`: the board's challenge or example for it, with its names and numbers, so the practice tasks are
    written in the same spirit. No solution.

  The board's own skill doesn't go here: `readyToPractise` sends it.
- **`practice`, the event,** is sent the moment the learner asks during the lesson to practise something later ("add
  this to my practice"), with the same fields (`why` defaults to `asked`). The teacher says it's added. It answers 200
  with `{ "requested": true }`, or `{ "requested": false, "reason": "duplicate" }` (the same words on this board
  already) or `"limit"` (6 a board, the end's picks and unticked items included).
- **`preference`** is sent the moment the teacher saves (`remember`) or removes (`forget`) one, or the learner removes
  one in Didactra's "How I learn" panel.
  - `scope` is `all` or `board`. It's a hint: the platform files a line about drawing, the board, a diagram, a trace or
    a space under `board` whatever it says.
  - `forget` names the line by `preferenceId` (from the context, or from the answer to its `remember`), or else by
    `text`, matched without case.

What the platform does:
- `started` binds Didactra's session id to the row.
- `usage` and `ended` update the session's minutes and cost (Admin → Voice spend).
- `ended`:
  - stores the summary, which feeds `earlier` next time;
  - when `readyToPractise`, marks the skill as taught, so practice offers its tasks first. It never marks it mastered;
  - folds `profileNotes` into the learner profile;
  - keeps `objectives`, shown in the lesson panel's "What the board found". An item unticked by the learner counts as
    something they found hard, and goes to practice;
  - turns each of `practice` into a practice request, like the lab tutor's "practise this in a few days": on the
    learner's next practice visit a model matches it to a course skill or makes a narrow skill for it, its tasks are
    written from the challenge, and spaced practice schedules it. "What the board found" lists them.
- `practice` stores one such request.
- `preference` stores or removes the line in the learner's preferences.
- **The answers:**

  | Status | Meaning |
  |---|---|
  | 204 | done |
  | 200 | a `preference` applied: `{ "preferenceId": "…", "scope": "all" or "board" }`, the scope it was filed under. A `forget` of a line that doesn't exist answers 200 too, with `"preferenceId": null`. A `practice` applied: `{ "requested": … }`, as above. |
  | 409 | an event already applied; for a `preference` or a `practice`, with the same body as its first answer |
  | 401 / 404 / 410 | as for the context |

## 4. The frame's messages (full screen)

The platform's board page frames Didactra under its own bar. On a phone that leaves too little room, so the board can
go full screen.

- **Going in:** the platform's bar has the button (it's the platform's bar, and it works whatever Didactra's version).
- **While in full screen:** the bar is hidden, so Didactra's page shows the way out, a button in its own toolbar.
- **The messages:**
  - **Didactra → platform:** `window.parent.postMessage({ source: "didactra", type: "fullscreen", on: false }, PLATFORM_URL)`
    when its exit button is pressed, or Escape inside its page. `on: true` is accepted too, for a button of its own to go
    in.
  - **Platform → Didactra:** `{ source: "academia", type: "fullscreen", on: true | false }` to the frame, with Didactra's
    origin, whenever full screen changes, and when the frame loads. That includes leaving without the button: the
    browser's Back, Escape on the platform's page, the system's full-screen exit. Didactra shows its exit button only
    while told `on: true`.
- **Each side checks** the message's `origin` (the platform: `BOARD_URL`'s origin and the frame's own window;
  Didactra: `PLATFORM_URL`'s origins) and ignores anything else.
- **What the platform does when on** (`components/courses/board-fullscreen.ts`):
  - the frame fills the window (`100dvh`) over the site's header, and the bar is hidden. It's the same element, so the
    lesson never reloads;
  - the browser's Fullscreen API is asked where it exists (Android, desktop). Safari on iPhone has none for a page, so
    there the layout alone gives the full screen;
  - Back leaves full screen before it leaves the page.
- **Outside the platform** (Didactra on its own), its button uses the Fullscreen API itself.

## Deepgram tags

When Didactra uses the platform's Deepgram project, every Deepgram call it makes carries a `tag` query parameter:

| Call | Tag |
|---|---|
| Listening (speech to text) | `adc-whiteboard-listen` |
| Speaking (Deepgram TTS) | `adc-whiteboard-speak` |
| Anything outside a platform session (development lessons on a PC, measurement tools), listening or speaking | `adc-whiteboard-dev` |

Admin → Spend counts those calls as the whiteboard's (`lib/spend/charges.ts` `WORKLOADS`). A call by the platform's key
with no known tag is flagged as one the platform didn't make. With a Deepgram project of its own, Didactra needs no tags.

## Replay and transcripts

They stay in Didactra. The platform links to them with a launch token whose payload adds `"view": "replay"` (or
`"transcript"`). Didactra then opens that session's replay or export, read-only.

## What each side builds

- **Platform (this repo):**
  - `BoardSession` and its migration;
  - signing (`lib/board/token.ts`);
  - the launch action;
  - the two endpoints;
  - the board page with its frame;
  - the buttons;
  - spend in Admin → Voice spend;
  - the preferences (their table, the guard for board lines, the `preference` event, `preferences` in the context) and
    the "How I learn" page;
  - `objectives` in the lesson panel;
  - practice from the board: the summary's `practice` and the `practice` event as practice requests, resolved by the lab
    tutor's resolver, and listed in "What the board found";
  - full screen: the button to go in, listening to the frame, the layout, the Fullscreen API, Back.
- **Didactra (its repo):**
  - `/launch`, the cookie, and identity per learner;
  - sessions stored per user and bound to `sid`;
  - the context client and its prompt section;
  - the events client, with retries;
  - CSP for the frame;
  - Spanish and English;
  - Pocket TTS;
  - a built page;
  - scoped `remember` and `forget`, sent as `preference` events, and "How I learn" showing the platform's preferences;
  - the checklist's outcomes in `objectives`;
  - the summary's `practice` picks, the `practice` event when the learner asks, and the recap naming what goes to
    practice;
  - the exit button while in full screen and its messages, and settings panels that are easy to close on a phone.
