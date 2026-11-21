# Voice spend

Admin → Spend (`/admin/spend`) answers, for any month: what did ElevenLabs and Deepgram bill this platform, for what,
and did anything use the platform's keys that the platform didn't do itself. The platform shares its ElevenLabs
workspace and Deepgram project with other workloads; this page reads both providers' own reports, so the platform is
never the blind spot.

## Two sources, checked against each other

**1. The platform's ledger** (`ProviderCharge`, `lib/spend/charges.ts`): one row per billable call, written by whatever
made it, the moment the call returns, failed calls included, with what it was for:

| Workload | Provider | Made by | Provider id stored |
|---|---|---|---|
| `lesson-audio.voice`: each piece of a lesson voiced | ElevenLabs or Deepgram | the practice worker | x-trace-id / dg-request-id |
| `lesson-audio.preview`: "Hear it" samples | ElevenLabs or Deepgram | the platform | x-trace-id / dg-request-id |
| `captions.transcribe`: a video's captions | Deepgram | the platform | the response's request id |
| `tutor.speak`: a reply read aloud | Deepgram | the lab's learning service | dg-request-id |
| `tutor.listen`: a microphone stream | Deepgram | the learner's browser, granted by the learning service | none (by tag, below) |
| `practice.listen`: an explanation dictated in practice | Deepgram | the learner's browser, granted by the platform | none (by tag, below) |
| `practice-coach.listen`: the practice coach's microphone | Deepgram | the learner's browser, granted by the learning service | none (by tag, below) |
| `practice-coach.speak`: the practice coach's replies read aloud | Deepgram | the lab's learning service | dg-request-id |

Each row has the course, lesson, lesson audio, video, voice, model, user, characters, audio seconds and an estimate at
list price. A lesson that fails halfway has still recorded the pieces it paid for. Writing a row never fails the work.

**2. What the providers report** for the platform's keys (`lib/spend/providers.ts`, read only, cached 5 minutes):

- **ElevenLabs** workspace analytics:
  - `usage-by-product-over-time`, per key, model and hour: **credits**, minutes, the US$ figure it puts on them, request
    counts. Its key hash is `sha256(hex(sha256(key)))`, so the platform finds its own key with no setting.
  - `requests`: every request of the platform's key (hash `sha256(key)`), with its trace id, path, response code and
    latency. No IP address or user agent: a key is all that tells callers apart, so each place that calls ElevenLabs
    (the platform, the practice worker, the learning service, a PC) should have its own key.
  - `user/subscription`: the plan's counter (credits used this period, the allowance, the reset), shown if the key
    has the User: read permission.
- **Deepgram** Manage API: every request of the project with its key, path, tag and **exact US$**; the project's keys
  (with their comments) and the credit balance. Every Deepgram call the platform makes carries a `tag` naming its
  workload (`WORKLOADS`), so Deepgram's own log says what each call was, the tutor's browser streams included.

## What the page shows

**ElevenLabs in credits.** The plan bills credits, and credits are what the dashboard counts, so ElevenLabs comes in
credits first, US$ second:

- Each call's credits are the provider's own: its response's `character-cost` header, kept on the charge
  (`detail.characterCost`). A call without it is estimated from its characters at the model's measured rate
  (`CREDITS_PER_CHARACTER`: Eleven v4 about 0.49 a character, Flash v2.5 about 0.25, on this account, 2026-11-20).
- **ElevenLabs credits**: the plan's counter (with User: read), the platform's key this month by model, the whole
  workspace, and **Voiced again**: lesson pieces paid for twice because their voicing was cut off and started over.
- **By key**: every key of the workspace this month, the platform's marked, with credits, requests, models and when
  last used. A key that shouldn't be in use spending credits is how a leak shows.
- **The last 48 hours by hour**, every key stacked, and the month's busiest hour.

- **Status**: "Accounted for", or "Needs a look" with the calls the platform didn't log.
- **Billed to the platform**: the providers' own figures for the platform's keys; per provider beside what the ledger
  logged (requests, characters, estimate), the month's billed ElevenLabs rate, and Deepgram's credit left.
- **Unaccounted**:
  - ElevenLabs: speech requests by the platform's key whose trace id no charge has (made since per-call logging began),
    each with what it was (a streamed answer or speech, the voice), its latency, and where it most likely came from: the
    piece in flight when a lesson's voicing was cut off (the worker stopped as it ran, so its charge was never written),
    or a streamed answer made outside the learning service (a local test with the key). And the credits billed beyond
    what the ledger logged, on whole days of per-call logging.
  - Deepgram: requests by the platform's key with none of the platform's tags and no charge's request id, each with its
    exact cost.
  These are calls the platform's code didn't make: a leaked key, the same key used on a PC or in a script. A local test
  run with the production key shows up here too, which is why development should use its own keys.
- **Other keys** in the same ElevenLabs workspace and Deepgram project, and the whole account's month, for context.
- **By workload, day, course, voice, lesson and user**, with calls, characters, audio, estimate and billed. ElevenLabs'
  billed US$ is shared out by characters at the month's billed rate; Deepgram's is exact per request (matched by request
  id), and per workload by tag.
- **Latest calls**, each marked as found in the provider's log or not (logs lag a few minutes).

## Exports

`/api/admin/spend/export?month=YYYY-MM&format=csv|json` (the page's CSV and JSON buttons), admins only:

- **CSV**: one row per billable call: time, provider, workload, model, voice, status, characters, audio seconds,
  estimated and billed US$, how it was billed (`provider request`, `provider rate`, `estimate`), whether the provider's
  log has it, its provider id, where it was made, course, lesson, user, and whether it was backfilled.
- **JSON**: the whole report: totals and status, each provider's reconciliation (with every unaccounted request), the
  breakdowns, every call, and a `glossary` of the fields, so an AI or a script can read it without this page.

## Prices, and what this account is really billed

Estimates use list prices (`LIST_PRICES`); "billed" is always the provider's figure. ElevenLabs bills this account in
plan credits, paid ahead with the plan; its report also puts a US$ figure on them (US$2.03 for 9,235 credits and US$7.11
for 37,950, 2026-11-19/20), which the page shares out by credits. Lesson-audio US$ estimates use US$0.21 per 1,000
characters.

**2026-11-19, read from ElevenLabs' own reports**: 619,900 credits from 20:00 New York time to the end of the night,
617,511 of them by the platform's key, nearly all lesson voicing with Eleven v4 (417 requests, about 1,540 credits
each), the rest tutor answers. The SRE course's lessons run 40 to 70 minutes (about 6 characters a word, 0.49 credits a
character). The worker was killed for memory three times that night, and the voicings in progress started over;
kept pieces (`docs/lesson-audio.md`) now stop that.

## History

`20261120120000_provider_charges` creates the ledger and copies in the voice calls the AI ledger (`ai_request`) already
had: lessons voiced (one row per lesson) and the tutor's speech, without provider ids. Those are marked `backfilled`,
and provider requests from before per-call logging began are counted, not flagged. Lesson voicing no longer writes to
`ai_request`; the tutor still does, for its daily allowances (`lib/voice/allowance.ts`).

## If a key leaks

Rotate it in the provider's dashboard, then set the new one where it's used: Amplify (`ELEVENLABS_API_KEY`,
`DEEPGRAM_API_KEY`), the practice worker's and the learning service's `.env` on the lab server. ElevenLabs can also cap
a key's monthly credits in its dashboard (API keys); a cap on the platform's key bounds what a leak can cost.
