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

Each row has the course, lesson, lesson audio, video, voice, model, user, characters, audio seconds and an estimate at
list price. A lesson that fails halfway has still recorded the pieces it paid for. Writing a row never fails the work.

**2. What the providers report** for the platform's keys (`lib/spend/providers.ts`, read only, cached 5 minutes):

- **ElevenLabs** workspace analytics:
  - `usage-by-product-over-time`, per key and day: credits, minutes, **the US$ actually billed**, request counts. Its
    key hash is `sha256(hex(sha256(key)))`, so the platform finds its own key with no setting.
  - `requests`: every request of the platform's key (hash `sha256(key)`), with its trace id, path and response code.
- **Deepgram** Manage API: every request of the project with its key, path, tag and **exact US$**; the project's keys
  (with their comments) and the credit balance. Every Deepgram call the platform makes carries a `tag` naming its
  workload (`WORKLOADS`), so Deepgram's own log says what each call was, the tutor's browser streams included.

## What the page shows

- **Status**: "Accounted for", or "Needs a look" with the calls the platform didn't log.
- **Billed to the platform**: the providers' own figures for the platform's keys; per provider beside what the ledger
  logged (requests, characters, estimate), the month's billed ElevenLabs rate, and Deepgram's credit left.
- **Unaccounted**:
  - ElevenLabs: speech requests by the platform's key whose trace id no charge has (made since per-call logging began),
    and the characters billed beyond what the ledger logged, at the month's rate.
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
plan credits: its own report said US$2.03 for 9,235 characters and US$7.11 for 37,950 (2026-11-19/20), about US$0.19
to 0.22 per 1,000 characters, against the API's US$0.08 list price. Lesson-audio estimates use US$0.21.

## History

`20261120120000_provider_charges` creates the ledger and copies in the voice calls the AI ledger (`ai_request`) already
had: lessons voiced (one row per lesson) and the tutor's speech, without provider ids. Those are marked `backfilled`,
and provider requests from before per-call logging began are counted, not flagged. Lesson voicing no longer writes to
`ai_request`; the tutor still does, for its daily allowances (`lib/voice/allowance.ts`).

## If a key leaks

Rotate it in the provider's dashboard, then set the new one where it's used: Amplify (`ELEVENLABS_API_KEY`,
`DEEPGRAM_API_KEY`), the practice worker's and the learning service's `.env` on the lab server. ElevenLabs can also cap
a key's monthly credits in its dashboard (API keys); a cap on the platform's key bounds what a leak can cost.
