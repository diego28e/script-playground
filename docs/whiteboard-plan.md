# The whiteboard teacher on the platform (plan)

2026-11-25, your request: take the platform's lessons with Didactra (`16-didactra`), the AI teacher that talks and draws
on a whiteboard, so each skill is mastered with it. It must know the lesson being taken, keep a session per lesson or per
skill, keep Didactra's features, possibly use Pocket TTS, and use the LiveKit worker on the Oracle server, without
LiveKit Cloud if possible.

Status: **a plan for you to review; nothing is built or changed.** On the server I ran read-only commands only.

Facts are marked (Fact) with where they come from; my recommendations are (Proposal).

## 1. What's on the server today (Fact, read-only checks 2026-11-25)

- **The LiveKit piece there is Didactra's agent worker, not a LiveKit server.** The `tutor-worker` container registered
  as `didactra` with **LiveKit Cloud** (`LIVEKIT_URL` is the `didactra-…livekit.cloud` project, region Mexico) and
  taught a whole lesson through it: 5 turns, a cut-in, replies spoken in full.
- **No LiveKit server is installed** (no container, no binary, no `livekit.yaml`). The firewall lets in only 22, 80 and
  443 (`iptables` ends in REJECT), so a LiveKit server's media ports would be refused today even if one ran.
- **Both Didactra containers are stopped.**
  - `tutor-web` was killed for running out of memory: its 1 GB limit, with Vite's development server inside it.
  - `tutor-worker` was stopped a minute later.
- **They run old code:** commit `6c7b773`. Your Didactra repo is 16 commits ahead (`c8e770b`): M3's close-out, replay
  with the tutor's voice, kept sketches, board export, and M4 steps 1–4 (your edits read as events, pointing).
- **Room to spare:** 4 ARM cores, 23 GB of memory (20 GB available, with Pocket TTS using about 1.9 GB), 54 GB of disk.

## 2. LiveKit Cloud or a LiveKit server of our own

**Proposal: keep LiveKit Cloud (the free Build plan) for the media. Run the agent worker on the Oracle server, as
today.** Plan our own LiveKit server as a later phase (§8), for when usage outgrows the free plan.

Why:

| | LiveKit Cloud, Build plan (Fact, LiveKit's pricing, 2026-11-25) | Our own LiveKit server |
|---|---|---|
| Cost | $0. 5,000 WebRTC minutes a month; a self-hosted agent counts as a participant, so about **2,500 lesson minutes (≈ 40 hours) a month**. 5 concurrent sessions, 100 connections. Then Ship, $50 a month for 150,000 minutes. | $0 in fees; uses the server's bandwidth (Oracle's free tier includes 10 TB out a month). |
| What Didactra relies on | Works today: the hosted turn detector, adaptive interruption, and the `lk.agent.state` signal the page shows. | Didactra's own tests on a local LiveKit server (`docs/m3-latency-spike.md`): the full turn detector and adaptive interruption were refused (fell back to the small local model and plain VAD), and `lk.agent.state` never reached the page. |
| Speed | Measured by Didactra: the cloud hop adds 0.07–0.13 s. | Saves that hop at best. The server is in Bogotá, close to you. |
| Work and risk | None: it runs today. | A domain and TLS for the signalling, UDP ports opened in both Oracle's security list and the server's `iptables`, TURN over TLS for learners behind strict networks, and keeping it updated. |

So: a LiveKit server of our own buys little speed and loses features Didactra uses. Cloud's free plan covers your own
lessons and a small pilot. **Your earlier attempt** never reached the point of a LiveKit server. What stopped the
server deployment was the page: Vite's development server through the SSH tunnel (about 35 s to load, 10 s for a token)
and its 1 GB memory limit. A built page fixes both (§5, phase 1).

## 3. A session per skill, not per lesson

**Proposal: one whiteboard session per learner and skill.** The lesson page opens the next skill of that lesson still
to learn, and when a skill is done the teacher offers the next one.

Why per skill:

- **Skills are the platform's unit of mastery.** Each `PracticeSkill` has its own ladder, tasks, and review schedule
  (`docs/practice.md`). A session per skill can say exactly what was taught and hand that skill to practice.
- **A skill-sized board stays fast and readable.** Didactra's known limits grow with the board (Fact,
  `docs/system-design.md` in Didactra):
  - past about 200 commits, foresight misses its 150 ms window;
  - re-laying out the whole log slows long sessions.

  A lesson can have ten or more skills; one board for all of them would cross those limits.
- **Smaller context, better teaching.** The teacher gets one skill's goal, what comes before it (its prerequisites in
  the skill graph), and the part of the lesson that teaches it. It doesn't get the whole lesson at every turn.
- **Lessons without skills yet** (practice not drafted) get one session for the lesson, as a fallback.

How sessions behave:

- **Resume by default.** Opening a skill continues its last board; "New board" starts fresh. Earlier boards stay
  listed, with replay and transcript export (Didactra already has both).
- **Mastery stays with practice.** A whiteboard session records what the learner did and understood, and marks the
  skill "ready to practise". It doesn't mark it mastered: graded practice decides that, as today. The session's summary
  goes to the learner profile, so the voice teachers and the coach know it too.

## 4. How it fits together

**Proposal: Didactra stays its own app, served from its own address on the Oracle server.** The platform opens it with
a signed launch.

**Why not rebuild the board inside the platform** (Fact, from Didactra's code):
- The browser is the board's authority: it lays out, checks and commits every drawing, and runs the learner's code in
  a sandbox. The agent can't work without that page.
- Porting it means bringing Excalidraw, the board host, the trace widget and the sandbox into Next.js. Those come as
  raw TypeScript 7 packages with `.js`→`.ts` imports, global CSS (`overflow: hidden` on `html`) and code that only
  runs in a browser.
- The copy would also fall behind Didactra, which you're still building (M4 to M6).

So it's served as its own app instead:

```
learner ── academiadelcodigo.com (Amplify) ─────────────────────────┐
   │  "Learn on the whiteboard" → a signed launch (who, which skill) │ server to server:
   ▼                                                                 │ the skill's context,
board.academiadelcodigo.com (Oracle, nginx + TLS)                    │ and the session's
   ├─ Didactra's page, built (a few files, not Vite's 120)           │ summary at the end
   ├─ its server: checks the launch, mints the LiveKit token ◄───────┘
   └─ the code sandbox on its own origin: run.board.academiadelcodigo.com
tutor-worker (Oracle) ── LiveKit Cloud ── the learner's browser (voice, board messages)
   └─ Pocket TTS (lab-voice network), Deepgram, Claude or Qwen
```

- **The platform's page** `/courses/<course>/<module>/<lesson>/board/<skill>` shows the board full screen inside the
  platform: its header (course, lesson, skill, back to the lesson) and Didactra's page in a frame allowed the
  microphone.
- **The launch:** a token the platform signs, valid a minute: user, course, lesson, skill, language and session. It
  works like the lab's lesson tutor (`LESSON_TUTOR_URL` and `LESSON_TUTOR_SECRET`). Didactra's server checks it; this
  replaces its "this PC only" rule (SEC-3) for the public address.
- **The context comes from the platform**, server to server. Didactra's server fetches it and hands it to the agent:
  - the skill (label, description, `criteriaHint`) and its prerequisites, with the learner's state in each;
  - the lesson's text around the skill, and its objectives;
  - the learner's profile (`LearnerProfile`, course and all);
  - the learner's recent practice on that skill: what was missed.
- **Identity per learner.** Didactra uses one hard-coded `learner` and one profile file; that becomes the platform's
  user. Its sessions are stored per user and bound to the platform's `BoardSession` row. Its own "How I learn" profile
  gives way to the platform's.

## 5. The work, in phases

**Phase 1 (in Didactra's repo): ready to be served.** Done in a Didactra session, not this one.
- A built page served by its server, and a production start. This also ends the 1 GB out-of-memory.
- The signed launch replaces the localhost-only checks; identity per learner; sessions stored per user.
- The context input (skill, lesson, prerequisites, profile, practice) in the teacher's prompt.
- **Spanish and English.** Today it's English only (`nova-3` with `en`, English voices). Change to:
  - listening: Deepgram Flux Multilingual, as the platform's voice teachers;
  - speaking: a voice per language;
  - the prompt: the learner's language, technical terms in English.
- **Pocket TTS as a voice:** a TTS for the LiveKit agent that calls `pocket-tts-en` / `pocket-tts-es` sentence by
  sentence. Pocket already streams WAV (`lib/voice/pocket.ts` here). Didactra's acknowledgment clips ("Okay.") are
  remade in that voice. Measure the time to first sound against Deepgram Flux before making it the default.
- The end-of-session summary sent to the platform.

**Phase 2 (on the server, you run the commands): the address.**
- DNS records `board.` and `run.board.` → `149.130.186.62`; nginx sites and Let's Encrypt certificates, as for
  `lab.academiadelcodigo.com`. **No new ports:** with LiveKit Cloud only 80 and 443 are needed.
- The containers from the latest commit. The worker joins `lab-voice` (to reach Pocket TTS); the page's server stays on
  the server's loopback behind nginx.

**Phase 3 (in this repo): the platform side.**
- `BoardSession` (user, course, lesson, skill, Didactra's session id, status, minutes, cost, summary) and its migration.
- "Learn on the whiteboard":
  - on each skill of the lesson page;
  - on the lesson as a whole (the next skill to learn);
  - on a practice skill's card.
- The launch action, the context endpoint, the summary endpoint (marks the skill ready to practise, updates the
  profile), and the board page with its frame.
- Admin → Voice spend counts whiteboard minutes and model cost (`docs/voice-spend.md`). Model calls get an allowance
  per learner, like the other model features. Deepgram isn't capped (your rule).
- **Who sees it first:** admins only (you), then a course switch, as with hands-on stops.

**Phase 4 (later, optional): our own LiveKit server.** When lessons pass about 40 hours a month, or for data you want
kept off LiveKit's network:
- the `livekit/livekit-server` image, which has an ARM64 build;
- `livekit.academiadelcodigo.com` behind nginx for signalling;
- one UDP port for media (`rtc.udp_port`), plus TCP 7881, opened in Oracle's security list and `iptables`;
- TURN over TLS for strict networks.

First check what the turn detector and interruption do on it, since Didactra saw both fall back.

## 6. Cost (Fact where measured)

- **Per lesson hour:** about $2.50, measured by Didactra with Claude Sonnet 5.5 as the teacher. Most of it is the
  model.
  - Qwen4-Max through DolphinGo is the cheaper option. DolphinGo's key already allows the server's address (Didactra's
    `docs/deploy-ampere.md` §8).
  - Pocket TTS removes the voice's share.
- **LiveKit:** $0 within about 40 hours a month (§2).
- **Server:** nothing new.

## 7. Decisions for you

Decided 2026-11-25 (your answer: "Yes, all three"):

1. **A session per skill**, with resume, and a lesson session when a lesson has no skills yet.
2. **Didactra as its own app at `board.academiadelcodigo.com`**, shown full screen in the platform.
3. **LiveKit Cloud's free plan now**, our own LiveKit server later (phase 4).

Still open (until you decide, the work keeps Didactra's tested defaults and admins only):

4. **The teacher's model by default:** Claude Sonnet 5.5 (Didactra's tested default) or Qwen4-Max (cheaper,
   less tested with the board's line language)?
5. **The voice by default:** Pocket TTS (free) or Deepgram Flux (Didactra's tested default), after measuring the
   first?
6. **Who gets it first:** you only, then a course switch?

## 8. Where the work runs

- **Phase 1** belongs in Didactra's repo: a session there, with this plan's §4 and §5 as its brief.
- **Phase 2** is server commands, given to you one at a time with a read-only check before and after each change.
- **Phase 3** is here.

Phases 1 and 3 can run at the same time once the launch token, the context and the summary are agreed. They are
specified in `docs/whiteboard-contract.md`.
