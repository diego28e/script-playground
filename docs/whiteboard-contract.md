# The platform and the whiteboard: the contract

What the platform (this repo, `academiadelcodigo.com`) and Didactra (`16-didactra`, served at
`board.academiadelcodigo.com`) say to each other. Both sides build against this page; a change to it is agreed first,
then made on both sides. The plan is in `docs/whiteboard-plan.md`.

Three exchanges:

1. **The launch:** the platform opens the board for one learner and one session.
2. **The context:** Didactra's server asks the platform what to teach.
3. **The events:** Didactra's server tells the platform how the session went.

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
   | `role` | `USER` or `ADMIN`. Admins may pick the model and the voice; learners get the defaults. |
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
    "text": "the part of the lesson that teaches this skill, up to 12,000 characters"
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
  "earlier": ["the summaries of this skill's earlier whiteboard sessions, newest first, at most 3"]
}
```

- **`kind`** is `skill` or `lesson`. For `lesson`, `skill` is `null`, and `lesson.text` is the lesson's start, up to
  the limit.
- **`state`** is the platform's reading of the learner's practice state (lk-practice) for that skill. It is one of
  `new`, `learning`, `reviewing` or `secure`.
- **`course.code`** is the language the course's code is in: `python` or `typescript`. The tracer runs JS/TS today;
  Python is Didactra's M5.
- **`practice.recent`** holds at most 5 answers to this skill's tasks, newest first.
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
    "profileNotes": ["how this learner learns, worth keeping (the same kind of note the voice teachers keep)"]
  }
}
```

- **`usage`** is the session's cumulative total, not a delta. It's sent every 10 minutes or so, and whenever a Didactra
  job closes (a page reload or a dropped connection closes the job, and the same board comes back on the next
  connect). So a session that never ends cleanly still counts.
- **`ended`**, also cumulative, is sent once, in one of two cases:
  - the learner presses **End the lesson** on the board page;
  - 2 hours have passed with no job on that session (Didactra's retry sweeper sends it).

  A job closing is not an end.

What the platform does:
- `started` binds Didactra's session id to the row.
- `usage` and `ended` update the session's minutes and cost (Admin → Voice spend).
- `ended`:
  - stores the summary, which feeds `earlier` next time;
  - when `readyToPractise`, marks the skill as taught, so practice offers its tasks first. It never marks it mastered;
  - folds `profileNotes` into the learner profile.
- **The answers:**

  | Status | Meaning |
  |---|---|
  | 204 | done |
  | 409 | an event already applied |
  | 401 / 404 / 410 | as for the context |

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
  - spend in Admin → Voice spend.
- **Didactra (its repo):**
  - `/launch`, the cookie, and identity per learner;
  - sessions stored per user and bound to `sid`;
  - the context client and its prompt section;
  - the events client, with retries;
  - CSP for the frame;
  - Spanish and English;
  - Pocket TTS;
  - a built page.
