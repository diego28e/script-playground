import { prisma } from "@/lib/prisma";
import { NARRATION_VOICES } from "@/lib/lesson-audio/voice";
import { chargeCredits, PROVIDERS, WORKLOADS, workloadOfTag, type Provider } from "@/lib/spend/charges";
import { deepgramReport, elevenReport, type ElevenPlan } from "@/lib/spend/providers";

// The month's voice spend (docs/voice-spend.md): the platform's ledger of every billable call (lib/spend/charges.ts)
// joined with what ElevenLabs and Deepgram themselves report for the platform's keys (lib/spend/providers.ts). One
// structure, for Admin → Spend and for its CSV and JSON exports.
//
// "Billed" is the provider's figure: ElevenLabs' own US$ for the platform's key, Deepgram's US$ for each request. Below
// the provider totals, ElevenLabs' spend is shared out by credits at the month's billed rate, and Deepgram's is exact
// per request where the request id matched (the tutor's microphone streams by their tag).
// ElevenLabs bills plan credits, and credits are what its dashboard counts, so its figures are in credits first: each
// call's own (its response's character-cost header, kept in the ledger), the provider's per key and hour, and the
// plan's counter when the key may read it.
// "Unaccounted" is what a provider saw the platform's key do that the ledger didn't record: the platform's code didn't
// make it (a leaked key, a script on someone's computer), or the call's row was lost.

export type SpendRow = { key: string; label: string; calls: number; failedCalls: number; characters: number; credits: number; audioSeconds: number; estimatedUsd: number; billedUsd: number };
export type UnaccountedItem = {
  at: string;
  requestId: string;
  path: string;
  code: number;
  usd: number | null;
  /** What it was, from its path: "Spoken tutor answer (Flash v2.5)", "Speech, Jarnathan". */
  kind: string;
  latencySeconds: number | null;
  /** Where it most likely came from, when the ledger around it says. */
  likely: string | null;
};
/** ElevenLabs in credits, its billing unit. */
export type ElevenCredits = {
  /** The platform's key, this month, as ElevenLabs reports it. */
  billed: number;
  /** The ledger's calls: each one's own figure where its response gave one, else estimated from its characters. */
  logged: number;
  loggedEstimated: number;
  /** Billed beyond what the ledger logged, on whole days of per-call logging. */
  unaccounted: number;
  /** The platform's key by model. */
  byModel: { model: string; credits: number; requests: number }[];
  /** Every key of the workspace (and the website, without a key), this month. */
  keys: { name: string; platform: boolean; credits: number; requests: number; usd: number; lastUsed: string | null; models: string[] }[];
  account: number;
  /** The last 48 hours of the month (UTC), every key. */
  byHour: { hour: string; total: number; byKey: Record<string, number> }[];
  /** The hour with the most credits this month. */
  peak: { hour: string; credits: number; byKey: Record<string, number> } | null;
  /** Lesson pieces voiced again: a voicing cut off (the worker stopped, a credit limit) starts over from its first piece. */
  revoiced: { credits: number; pieces: number; characters: number; lessons: { label: string; credits: number; pieces: number }[] };
  plan: ElevenPlan | null;
};
export type ProviderSection = {
  provider: Provider;
  status: "ok" | "attention" | "unavailable";
  error: string | null;
  /** The platform's key, as the provider reports it. */
  billed: { usd: number; requests: number; characters: number | null };
  /** The platform's own ledger. */
  logged: { calls: number; failedCalls: number; characters: number; audioSeconds: number; estimatedUsd: number };
  /** US$ per 1,000 units actually billed this month: ElevenLabs credits (null: none billed yet). */
  billedPer1000: number | null;
  unaccounted: { requests: number; usd: number | null; items: UnaccountedItem[] };
  /** ElevenLabs: credits billed beyond those logged, on whole days of per-call logging. */
  unaccountedCredits: number;
  /** When per-call logging started for this provider: requests before it can't be matched and aren't flagged. */
  ledgerSince: string | null;
  requestsBeforeLedger: number;
  /** Requests by the platform's key that cost nothing (reading voices, models), by path. */
  otherCalls: { path: string; count: number }[];
  otherKeys: { name: string; usd: number; requests: number }[];
  /** The whole account (every key), this month. */
  accountUsd: number;
  balanceUsd: number | null;
  notes: string[];
};
export type ChargeRow = {
  at: string;
  provider: Provider;
  workload: string;
  workloadLabel: string;
  model: string | null;
  voice: string | null;
  voiceLabel: string | null;
  status: string;
  characters: number;
  /** ElevenLabs credits (null for Deepgram). */
  credits: number | null;
  /** The credits are the provider's own figure for this call (else estimated from its characters). */
  creditsExact: boolean | null;
  audioSeconds: number | null;
  estimatedUsd: number;
  billedUsd: number;
  billedBasis: "provider request" | "provider rate" | "estimate";
  /** A lesson piece voiced again later, after its voicing was cut off: paid for, and thrown away. */
  revoiced: boolean;
  requestId: string | null;
  /** The provider's log has this call (null: it can't be checked). */
  matched: boolean | null;
  runtime: string;
  courseTitle: string | null;
  lessonCode: string | null;
  lessonTitle: string | null;
  userId: string | null;
  userName: string | null;
  backfilled: boolean;
};
export type SpendReport = {
  schemaVersion: 1;
  generatedAt: string;
  month: string;
  range: { start: string; end: string };
  currency: "USD";
  totals: { billedUsd: number; estimatedUsd: number; unaccountedUsd: number; unaccountedRequests: number; calls: number; failedCalls: number; status: "ok" | "attention" | "unavailable" };
  providers: Record<Provider, ProviderSection>;
  byWorkload: (SpendRow & { provider: Provider })[];
  byCourse: SpendRow[];
  byLesson: SpendRow[];
  byVoice: SpendRow[];
  byUser: SpendRow[];
  byDay: { day: string; elevenlabsBilledUsd: number; elevenlabsCredits: number; deepgramBilledUsd: number; estimatedUsd: number; calls: number }[];
  elevenCredits: ElevenCredits;
  charges: ChargeRow[];
  glossary: Record<string, string>;
};

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const emptyRow = (key: string, label: string): SpendRow => ({ key, label, calls: 0, failedCalls: 0, characters: 0, credits: 0, audioSeconds: 0, estimatedUsd: 0, billedUsd: 0 });
const HOURS_SHOWN = 48;
const piece = (detail: unknown) => {
  const value = detail as { piece?: unknown; of?: unknown; revision?: unknown } | null;
  return typeof value?.piece === "number" ? { piece: value.piece, of: Number(value.of ?? 0), revision: Number(value.revision ?? 0) } : null;
};

/** "2026-11" → the month in UTC, its end capped at now. */
export function monthRange(month?: string | null) {
  const now = new Date();
  const valid = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [year, monthIndex] = valid.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const next = new Date(Date.UTC(year, monthIndex, 1));
  const end = next > now ? now : next;
  return { month: valid, start, end };
}

export async function buildSpendReport(monthParam?: string | null): Promise<SpendReport> {
  const { month, start, end } = monthRange(monthParam);
  const [charges, eleven, deepgram, firstCalls] = await Promise.all([
    prisma.providerCharge.findMany({ where: { createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" } }),
    elevenReport(start.getTime(), end.getTime()),
    deepgramReport(start.getTime(), end.getTime()),
    // Per-call logging started with the first charge that has a provider id (backfilled rows have none).
    Promise.all(PROVIDERS.map((provider) => prisma.providerCharge.findFirst({ where: { provider, OR: [{ requestId: { not: null } }, { workload: "tutor.listen", detail: { path: ["upperBound"], equals: true } }] }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }))),
  ]);
  const ledgerSince: Record<Provider, Date | null> = { elevenlabs: firstCalls[0]?.createdAt ?? null, deepgram: firstCalls[1]?.createdAt ?? null };

  // Names for what the charges point at.
  const ids = (pick: (charge: (typeof charges)[number]) => string | null) => [...new Set(charges.map(pick).filter((id): id is string => Boolean(id)))];
  const [courses, lessons, users] = await Promise.all([
    prisma.course.findMany({ where: { id: { in: ids((charge) => charge.courseId) } }, select: { id: true, title: true } }),
    prisma.lesson.findMany({ where: { id: { in: ids((charge) => charge.lessonId) } }, select: { id: true, code: true, title: true } }),
    prisma.user.findMany({ where: { id: { in: ids((charge) => charge.userId) } }, select: { id: true, name: true } }),
  ]);
  const courseName = new Map(courses.map((course) => [course.id, course.title]));
  const lessonInfo = new Map(lessons.map((lesson) => [lesson.id, { code: lesson.code, title: lesson.title.replaceAll("`", "") }]));
  const userName = new Map(users.map((user) => [user.id, user.name ?? "Unnamed"]));
  const voiceLabel = new Map(NARRATION_VOICES.map((voice) => [voice.id, voice.label]));

  // --- ElevenLabs -----------------------------------------------------------------------------------------------
  const elevenCharges = charges.filter((charge) => charge.provider === "elevenlabs");
  const elevenOk = elevenCharges.filter((charge) => charge.status === "ok");
  const creditsOf = new Map(elevenCharges.map((charge) => [charge.id, chargeCredits(charge)]));

  // Lesson pieces voiced more than once in one revision: every one but the last was thrown away when its voicing was
  // cut off and started over. Where each cut-off attempt ended, for the unaccounted requests below.
  const revoicedIds = new Set<string>();
  const cutOffs: { at: number; label: string }[] = [];
  {
    const latest = new Map<string, string>();
    const voiced = charges.filter((charge) => charge.workload === "lesson-audio.voice" && charge.status === "ok" && charge.audioId && piece(charge.detail));
    for (const charge of voiced) {
      const at = piece(charge.detail)!;
      const key = `${charge.audioId}:${at.revision}:${at.piece}:${at.of}`;
      const before = latest.get(key);
      if (before) revoicedIds.add(before);
      latest.set(key, charge.id);
    }
    const byAudio = new Map<string, typeof voiced>();
    for (const charge of voiced) byAudio.set(charge.audioId!, [...(byAudio.get(charge.audioId!) ?? []), charge]);
    for (const list of byAudio.values()) {
      for (let index = 0; index + 1 < list.length; index++) {
        const here = piece(list[index].detail)!;
        const next = piece(list[index + 1].detail)!;
        if (next.revision === here.revision && next.piece <= here.piece) cutOffs.push({ at: list[index].createdAt.getTime(), label: list[index].lessonId ?? "" });
      }
    }
  }
  const elevenSection: ProviderSection = {
    provider: "elevenlabs",
    status: "ok",
    error: null,
    billed: { usd: 0, requests: 0, characters: 0 },
    logged: {
      calls: elevenCharges.length,
      failedCalls: elevenCharges.length - elevenOk.length,
      characters: elevenOk.reduce((sum, charge) => sum + charge.characters, 0),
      audioSeconds: elevenOk.reduce((sum, charge) => sum + (charge.audioSeconds ?? 0), 0),
      estimatedUsd: elevenOk.reduce((sum, charge) => sum + charge.estimatedMicros / 1_000_000, 0),
    },
    billedPer1000: null,
    unaccounted: { requests: 0, usd: null, items: [] },
    unaccountedCredits: 0,
    ledgerSince: ledgerSince.elevenlabs?.toISOString() ?? null,
    requestsBeforeLedger: 0,
    otherCalls: [],
    otherKeys: [],
    accountUsd: 0,
    balanceUsd: null,
    notes: [],
  };
  const elevenTraceIds = new Set(elevenCharges.map((charge) => charge.requestId).filter(Boolean) as string[]);
  const elevenSeen = new Set<string>();
  const elevenDaily = new Map<string, number>();
  const elevenDailyCredits = new Map<string, number>();
  const credits: ElevenCredits = {
    billed: 0,
    logged: 0,
    loggedEstimated: 0,
    unaccounted: 0,
    byModel: [],
    keys: [],
    account: 0,
    byHour: [],
    peak: null,
    revoiced: { credits: 0, pieces: 0, characters: 0, lessons: [] },
    plan: null,
  };
  for (const charge of elevenOk) {
    const { credits: amount, exact } = creditsOf.get(charge.id)!;
    credits.logged += amount;
    if (!exact) credits.loggedEstimated += amount;
  }
  if (!eleven.ok) {
    elevenSection.status = "unavailable";
    elevenSection.error = eleven.error;
  } else {
    const own = eleven.usage.filter((row) => row.keyHash === eleven.ownUsageHash);
    // ElevenLabs reports credits, not characters.
    elevenSection.billed = { usd: own.reduce((sum, row) => sum + row.usd, 0), requests: own.reduce((sum, row) => sum + row.requests, 0), characters: null };
    credits.billed = own.reduce((sum, row) => sum + row.credits, 0);
    credits.plan = eleven.plan;
    for (const row of own) {
      elevenDaily.set(row.day, (elevenDaily.get(row.day) ?? 0) + row.usd);
      elevenDailyCredits.set(row.day, (elevenDailyCredits.get(row.day) ?? 0) + row.credits);
    }
    elevenSection.billedPer1000 = credits.billed ? (elevenSection.billed.usd / credits.billed) * 1000 : null;
    const models = new Map<string, { model: string; credits: number; requests: number }>();
    for (const row of own) {
      const entry = models.get(row.model) ?? { model: row.model, credits: 0, requests: 0 };
      entry.credits += row.credits;
      entry.requests += row.requests;
      models.set(row.model, entry);
    }
    credits.byModel = [...models.values()].sort((a, b) => b.credits - a.credits);

    // Every key, the platform's among them: a key that shouldn't be in use spending credits is how a leak shows.
    const keys = new Map<string, ElevenCredits["keys"][number]>();
    for (const row of eleven.usage) {
      const entry = keys.get(row.keyHash) ?? { name: row.keyName, platform: row.keyHash === eleven.ownUsageHash, credits: 0, requests: 0, usd: 0, lastUsed: null, models: [] };
      entry.credits += row.credits;
      entry.requests += row.requests;
      entry.usd += row.usd;
      if (!entry.lastUsed || row.hour > entry.lastUsed) entry.lastUsed = row.hour;
      if (row.model && !entry.models.includes(row.model)) entry.models.push(row.model);
      keys.set(row.keyHash, entry);
    }
    credits.keys = [...keys.values()].map((key) => ({ ...key, usd: round(key.usd), lastUsed: key.lastUsed ? `${key.lastUsed}:00:00Z` : null })).sort((a, b) => b.credits - a.credits);
    credits.account = eleven.usage.reduce((sum, row) => sum + row.credits, 0);

    // By hour: the month's peak, and the last 48 hours, every key.
    const hours = new Map<string, Record<string, number>>();
    for (const row of eleven.usage) {
      if (!row.credits) continue;
      const entry = hours.get(row.hour) ?? {};
      entry[row.keyName] = (entry[row.keyName] ?? 0) + row.credits;
      hours.set(row.hour, entry);
    }
    const sum = (byKey: Record<string, number>) => Object.values(byKey).reduce((total, value) => total + value, 0);
    for (const [hour, byKey] of hours) if (!credits.peak || sum(byKey) > credits.peak.credits) credits.peak = { hour: `${hour}:00:00Z`, credits: sum(byKey), byKey };
    const last = Math.floor(end.getTime() / 3_600_000) * 3_600_000;
    for (let at = last - (HOURS_SHOWN - 1) * 3_600_000; at <= last; at += 3_600_000) {
      if (at < start.getTime()) continue;
      const hour = new Date(at).toISOString().slice(0, 13);
      const byKey = hours.get(hour) ?? {};
      credits.byHour.push({ hour: `${hour}:00:00Z`, total: sum(byKey), byKey });
    }
    elevenSection.accountUsd = eleven.usage.reduce((sum, row) => sum + row.usd, 0);
    const others = new Map<string, { name: string; usd: number; requests: number }>();
    for (const row of eleven.usage.filter((entry) => entry.keyHash !== eleven.ownUsageHash)) {
      const entry = others.get(row.keyHash) ?? { name: row.keyName, usd: 0, requests: 0 };
      entry.usd += row.usd;
      entry.requests += row.requests;
      others.set(row.keyHash, entry);
    }
    elevenSection.otherKeys = [...others.values()].sort((a, b) => b.usd - a.usd);

    // Every speech request of the platform's key should have a charge with its trace id.
    const since = ledgerSince.elevenlabs?.getTime() ?? Infinity;
    const otherCalls = new Map<string, number>();
    for (const request of eleven.requests) {
      const speech = request.pathPattern.includes("text-to-speech") && request.method === "POST";
      if (!speech) {
        otherCalls.set(request.pathPattern, (otherCalls.get(request.pathPattern) ?? 0) + 1);
        continue;
      }
      if (elevenTraceIds.has(request.traceId)) {
        elevenSeen.add(request.traceId);
        continue;
      }
      if (request.code >= 400) continue; // Refused: not billed.
      if (Date.parse(request.at) < since) {
        elevenSection.requestsBeforeLedger += 1;
        continue;
      }
      const started = Date.parse(request.at);
      const voiceId = request.path.match(/text-to-speech\/([^/?]+)/)?.[1] ?? "";
      const voiceName = voiceLabel.get(voiceId) ?? (voiceId ? `voice ${voiceId.slice(0, 8)}` : "");
      const spokenAnswer = request.pathPattern.includes("/stream");
      // A lesson's voicing cut off right as this request ran: it was the piece in flight, paid for and never logged.
      const cut = spokenAnswer ? undefined : cutOffs.find((cutOff) => cutOff.at >= started - 150_000 && cutOff.at <= started + 10_000);
      const cutLesson = cut ? lessonInfo.get(cut.label) : undefined;
      elevenSection.unaccounted.items.push({
        at: request.at,
        requestId: request.traceId,
        path: request.path,
        code: request.code,
        usd: null,
        kind: spokenAnswer ? `Spoken answer, streamed${voiceName ? `, ${voiceName}` : ""}` : `Speech${voiceName ? `, ${voiceName}` : ""}`,
        latencySeconds: request.latencySeconds === null ? null : round(request.latencySeconds, 1),
        likely: cut
          ? `The piece in flight when ${cutLesson ? `${cutLesson.code ? `${cutLesson.code} · ` : ""}${cutLesson.title}` : "a lesson"}'s voicing was cut off (the worker stopped): its voicing started over.`
          : spokenAnswer
            ? "A streamed answer, as the lesson tutor makes. The lab's learning service logs its own, so this came from elsewhere: a local test with this key, or a leak."
            : null,
      });
    }
    elevenSection.otherCalls = [...otherCalls.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count);
    elevenSection.unaccounted.requests = elevenSection.unaccounted.items.length;
    // What the key was billed beyond what the ledger accounts for, in credits, day by day, from the first whole day of
    // per-call logging (the day it began also has calls from before it). At the month's rate. Estimated credits can be
    // a few percent off, so only a gap beyond that counts.
    const sinceDay = ledgerSince.elevenlabs?.toISOString().slice(0, 10) ?? "9999";
    const loggedByDay = new Map<string, number>();
    for (const charge of elevenOk) {
      const day = charge.createdAt.toISOString().slice(0, 10);
      loggedByDay.set(day, (loggedByDay.get(day) ?? 0) + creditsOf.get(charge.id)!.credits);
    }
    let unaccountedCredits = 0;
    for (const [day, billed] of elevenDailyCredits) {
      const gap = billed - (loggedByDay.get(day) ?? 0);
      if (day > sinceDay && gap > Math.max(500, billed * 0.03)) unaccountedCredits += gap;
    }
    elevenSection.unaccountedCredits = Math.round(unaccountedCredits);
    credits.unaccounted = elevenSection.unaccountedCredits;
    elevenSection.unaccounted.usd = elevenSection.billedPer1000 ? round((unaccountedCredits / 1000) * elevenSection.billedPer1000) : 0;
    const before = [...elevenDailyCredits.entries()].filter(([day]) => day <= sinceDay).reduce((total, [, amount]) => total + amount, 0);
    if (before) elevenSection.notes.push(`${before.toLocaleString("en-US")} credits were billed up to the day per-call logging began: they're in the totals, and checked request by request only from then on.`);
    if (!eleven.requestsComplete) elevenSection.notes.push("More than 10,000 requests this month: only the first 10,000 were checked one by one.");
    if (elevenSection.requestsBeforeLedger) elevenSection.notes.push(`${elevenSection.requestsBeforeLedger} speech requests were made before per-call logging began, and can only be checked in total.`);
    const tolerance = Math.max(0.5, elevenSection.billed.usd * 0.03);
    if (elevenSection.unaccounted.requests > 0 || (elevenSection.unaccounted.usd ?? 0) > tolerance) elevenSection.status = "attention";
  }

  // --- Deepgram -------------------------------------------------------------------------------------------------
  const deepgramCharges = charges.filter((charge) => charge.provider === "deepgram");
  const deepgramOk = deepgramCharges.filter((charge) => charge.status === "ok");
  const deepgramSection: ProviderSection = {
    provider: "deepgram",
    status: "ok",
    error: null,
    billed: { usd: 0, requests: 0, characters: null },
    logged: {
      calls: deepgramCharges.length,
      failedCalls: deepgramCharges.length - deepgramOk.length,
      characters: deepgramOk.reduce((sum, charge) => sum + charge.characters, 0),
      audioSeconds: deepgramOk.reduce((sum, charge) => sum + (charge.audioSeconds ?? 0), 0),
      estimatedUsd: deepgramOk.reduce((sum, charge) => sum + charge.estimatedMicros / 1_000_000, 0),
    },
    billedPer1000: null,
    unaccounted: { requests: 0, usd: 0, items: [] },
    unaccountedCredits: 0,
    ledgerSince: ledgerSince.deepgram?.toISOString() ?? null,
    requestsBeforeLedger: 0,
    otherCalls: [],
    otherKeys: [],
    accountUsd: 0,
    balanceUsd: null,
    notes: [],
  };
  const deepgramUsdById = new Map<string, number>();
  const deepgramByTag = new Map<string, number>();
  const deepgramDaily = new Map<string, number>();
  if (!deepgram.ok) {
    deepgramSection.status = "unavailable";
    deepgramSection.error = deepgram.error;
  } else {
    deepgramSection.balanceUsd = deepgram.balanceUsd;
    deepgramSection.accountUsd = deepgram.requests.reduce((sum, request) => sum + request.usd, 0);
    // The platform's key: the one that made the requests in the ledger, or the ones with the platform's tags.
    const ledgerIds = new Set(deepgramCharges.map((charge) => charge.requestId).filter(Boolean) as string[]);
    const votes = new Map<string, number>();
    for (const request of deepgram.requests) {
      if (ledgerIds.has(request.id) || workloadOfTag(request.tag)) votes.set(request.keyId, (votes.get(request.keyId) ?? 0) + 1);
    }
    // Deepgram names the key itself (a temporary token's accessor); the requests it made are the fallback.
    const ownKey = deepgram.ownKeyId ?? [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!ownKey) deepgramSection.notes.push("The platform's key couldn't be told apart from the project's others this month.");
    const since = ledgerSince.deepgram?.getTime() ?? Infinity;
    const others = new Map<string, { name: string; usd: number; requests: number }>();
    for (const request of deepgram.requests) {
      if (request.keyId !== ownKey) {
        const name = deepgram.keys.find((key) => key.id === request.keyId)?.comment || `Key ${request.keyId.slice(0, 8)}`;
        const entry = others.get(request.keyId) ?? { name, usd: 0, requests: 0 };
        entry.usd += request.usd;
        entry.requests += 1;
        others.set(request.keyId, entry);
        continue;
      }
      deepgramSection.billed.usd += request.usd;
      deepgramSection.billed.requests += 1;
      deepgramUsdById.set(request.id, request.usd);
      const day = request.at.slice(0, 10);
      deepgramDaily.set(day, (deepgramDaily.get(day) ?? 0) + request.usd);
      const workload = workloadOfTag(request.tag);
      if (workload) {
        deepgramByTag.set(workload, (deepgramByTag.get(workload) ?? 0) + request.usd);
        continue;
      }
      if (ledgerIds.has(request.id)) continue;
      if (Date.parse(request.at) < since) {
        deepgramSection.requestsBeforeLedger += 1;
        continue;
      }
      if (request.code >= 400 && request.usd === 0) continue;
      deepgramSection.unaccounted.items.push({ at: request.at, requestId: request.id, path: request.path, code: request.code, usd: round(request.usd, 6), kind: request.tag ? `Tagged ${request.tag}` : "No tag", latencySeconds: null, likely: null });
    }
    deepgramSection.otherKeys = [...others.values()].sort((a, b) => b.usd - a.usd);
    deepgramSection.unaccounted.requests = deepgramSection.unaccounted.items.length;
    deepgramSection.unaccounted.usd = round(deepgramSection.unaccounted.items.reduce((sum, item) => sum + (item.usd ?? 0), 0), 6);
    if (!deepgram.requestsComplete) deepgramSection.notes.push("More than 6,000 requests this month: only the first 6,000 were read, so totals are partial.");
    if (deepgramSection.requestsBeforeLedger) deepgramSection.notes.push(`${deepgramSection.requestsBeforeLedger} untagged requests were made before per-call logging began.`);
    if (deepgramSection.unaccounted.requests > 0) deepgramSection.status = "attention";
  }

  // --- Every charge, with what it was billed ----------------------------------------------------------------------
  const rows: ChargeRow[] = charges.map((charge) => {
    const provider = charge.provider as Provider;
    const estimatedUsd = charge.estimatedMicros / 1_000_000;
    let billedUsd = estimatedUsd;
    let billedBasis: ChargeRow["billedBasis"] = "estimate";
    let matched: boolean | null = null;
    if (provider === "deepgram" && charge.requestId && deepgram.ok) {
      matched = deepgramUsdById.has(charge.requestId);
      if (matched) {
        billedUsd = deepgramUsdById.get(charge.requestId)!;
        billedBasis = "provider request";
      }
    } else if (provider === "elevenlabs") {
      if (charge.requestId && eleven.ok) matched = elevenSeen.has(charge.requestId);
      if (charge.status === "ok" && elevenSection.billedPer1000) {
        billedUsd = (creditsOf.get(charge.id)!.credits / 1000) * elevenSection.billedPer1000;
        billedBasis = "provider rate";
      }
    }
    if (charge.status !== "ok" && billedBasis !== "provider request") billedUsd = 0;
    const lesson = charge.lessonId ? lessonInfo.get(charge.lessonId) : undefined;
    return {
      at: charge.createdAt.toISOString(),
      provider,
      workload: charge.workload,
      workloadLabel: WORKLOADS[charge.workload as keyof typeof WORKLOADS]?.label ?? charge.workload,
      model: charge.model,
      voice: charge.voice,
      voiceLabel: charge.voice ? (voiceLabel.get(charge.voice) ?? charge.voice) : null,
      status: charge.status,
      characters: charge.characters,
      credits: provider === "elevenlabs" ? creditsOf.get(charge.id)!.credits : null,
      creditsExact: provider === "elevenlabs" ? creditsOf.get(charge.id)!.exact : null,
      audioSeconds: charge.audioSeconds,
      estimatedUsd: round(estimatedUsd, 6),
      billedUsd: round(billedUsd, 6),
      billedBasis,
      revoiced: revoicedIds.has(charge.id),
      requestId: charge.requestId,
      matched,
      runtime: charge.runtime,
      courseTitle: charge.courseId ? (courseName.get(charge.courseId) ?? null) : null,
      lessonCode: lesson?.code ?? null,
      lessonTitle: lesson?.title ?? null,
      userId: charge.userId,
      userName: charge.userId ? (userName.get(charge.userId) ?? null) : null,
      backfilled: Boolean(charge.detail && typeof charge.detail === "object" && "backfilledFrom" in (charge.detail as object)),
    };
  });

  // --- Breakdowns -------------------------------------------------------------------------------------------------
  const group = (keyOf: (row: ChargeRow) => [string, string] | null) => {
    const groups = new Map<string, SpendRow>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const entry = groups.get(key[0]) ?? emptyRow(key[0], key[1]);
      entry.calls += 1;
      if (row.status !== "ok") entry.failedCalls += 1;
      entry.characters += row.status === "ok" ? row.characters : 0;
      entry.credits += row.credits ?? 0;
      entry.audioSeconds += row.audioSeconds ?? 0;
      entry.estimatedUsd += row.estimatedUsd;
      entry.billedUsd += row.billedUsd;
      groups.set(key[0], entry);
    }
    return [...groups.values()].map((entry) => ({ ...entry, estimatedUsd: round(entry.estimatedUsd), billedUsd: round(entry.billedUsd) })).sort((a, b) => b.billedUsd - a.billedUsd);
  };
  const byWorkload = PROVIDERS.flatMap((provider) =>
    group((row) => (row.provider === provider ? [row.workload, row.workloadLabel] : null)).map((entry) => ({
      ...entry,
      provider,
      // Deepgram's own figure per workload, from its tags, wherever it has one (the microphone streams need it).
      billedUsd: provider === "deepgram" && deepgramByTag.has(entry.key) ? round(deepgramByTag.get(entry.key)!) : entry.billedUsd,
    })),
  ).sort((a, b) => b.billedUsd - a.billedUsd);
  const byCourse = group((row) => [row.courseTitle ?? "(no course)", row.courseTitle ?? "Not tied to a course (tutor, samples)"]);
  const byLesson = group((row) => (row.lessonCode || row.lessonTitle ? [`${row.courseTitle}:${row.lessonCode}:${row.lessonTitle}`, `${row.lessonCode ? `${row.lessonCode} · ` : ""}${row.lessonTitle}`] : null)).slice(0, 50);
  const byVoice = group((row) => (row.voice ? [row.voice, `${row.voiceLabel} (${row.provider === "elevenlabs" ? "ElevenLabs" : "Deepgram"})`] : null));
  const byUser = group((row) => [row.userId ?? "(none)", row.userName ?? "No user"]).slice(0, 25);

  const revoicedRows = rows.filter((row) => row.revoiced);
  credits.revoiced = {
    credits: revoicedRows.reduce((total, row) => total + (row.credits ?? 0), 0),
    pieces: revoicedRows.length,
    characters: revoicedRows.reduce((total, row) => total + row.characters, 0),
    lessons: [],
  };
  const revoicedLessons = new Map<string, { label: string; credits: number; pieces: number }>();
  for (const row of revoicedRows) {
    const label = `${row.lessonCode ? `${row.lessonCode} · ` : ""}${row.lessonTitle ?? "A lesson"}`;
    const entry = revoicedLessons.get(label) ?? { label, credits: 0, pieces: 0 };
    entry.credits += row.credits ?? 0;
    entry.pieces += 1;
    revoicedLessons.set(label, entry);
  }
  credits.revoiced.lessons = [...revoicedLessons.values()].sort((a, b) => b.credits - a.credits);

  const days = new Map<string, SpendReport["byDay"][number]>();
  const dayOf = (day: string) => days.get(day) ?? days.set(day, { day, elevenlabsBilledUsd: 0, elevenlabsCredits: 0, deepgramBilledUsd: 0, estimatedUsd: 0, calls: 0 }).get(day)!;
  for (const [day, usd] of elevenDaily) dayOf(day).elevenlabsBilledUsd += usd;
  for (const [day, amount] of elevenDailyCredits) dayOf(day).elevenlabsCredits += amount;
  for (const [day, usd] of deepgramDaily) dayOf(day).deepgramBilledUsd += usd;
  for (const row of rows) {
    const entry = dayOf(row.at.slice(0, 10));
    entry.estimatedUsd += row.estimatedUsd;
    entry.calls += 1;
  }
  const byDay = [...days.values()]
    .map((entry) => ({ ...entry, elevenlabsBilledUsd: round(entry.elevenlabsBilledUsd), deepgramBilledUsd: round(entry.deepgramBilledUsd), estimatedUsd: round(entry.estimatedUsd) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  for (const section of [elevenSection, deepgramSection]) {
    section.billed.usd = round(section.billed.usd);
    section.logged.estimatedUsd = round(section.logged.estimatedUsd);
    section.accountUsd = round(section.accountUsd);
    section.billedPer1000 = section.billedPer1000 === null ? null : round(section.billedPer1000);
    section.otherKeys = section.otherKeys.map((key) => ({ ...key, usd: round(key.usd) }));
  }
  const sections = { elevenlabs: elevenSection, deepgram: deepgramSection };
  const statuses = [elevenSection.status, deepgramSection.status];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    month,
    range: { start: start.toISOString(), end: end.toISOString() },
    currency: "USD",
    totals: {
      billedUsd: round(elevenSection.billed.usd + deepgramSection.billed.usd),
      estimatedUsd: round(elevenSection.logged.estimatedUsd + deepgramSection.logged.estimatedUsd),
      unaccountedUsd: round((elevenSection.unaccounted.usd ?? 0) + (deepgramSection.unaccounted.usd ?? 0)),
      unaccountedRequests: elevenSection.unaccounted.requests + deepgramSection.unaccounted.requests,
      calls: rows.length,
      failedCalls: rows.filter((row) => row.status !== "ok").length,
      status: statuses.includes("attention") ? "attention" : statuses.includes("unavailable") ? "unavailable" : "ok",
    },
    providers: sections,
    byWorkload,
    byCourse,
    byLesson,
    byVoice,
    byUser,
    byDay,
    elevenCredits: { ...credits, logged: Math.round(credits.logged), loggedEstimated: Math.round(credits.loggedEstimated) },
    charges: rows,
    glossary: {
      billedUsd: "What the provider charged. ElevenLabs: its own US$ for the platform's key, shared out by credits at the month's billed rate. Deepgram: its US$ for each request, matched by request id, or by tag for the tutor's microphone streams.",
      credits: "ElevenLabs plan credits, what its dashboard counts. Per call: the response's own figure (its character-cost header), or, where a call didn't keep it, its characters at the model's measured rate (creditsExact false). elevenCredits: the provider's per key, model and hour, and the plan's counter when the key may read it (User: read).",
      revoiced: "A lesson piece voiced again later in the same revision: its voicing was cut off (the worker stopped, a credit limit) and started over from the first piece. Paid for and thrown away.",
      likely: "For an unaccounted request, where it most likely came from: the piece in flight when a voicing was cut off, or a streamed answer made outside the learning service.",
      estimatedUsd: "The platform's estimate when the call was made, at list price. The tutor's microphone is estimated at a full 10-minute stream, an upper bound.",
      unaccounted: "Calls the provider saw the platform's key make that the platform's ledger didn't record: made outside the platform's code (a leaked or reused key), or a ledger row lost.",
      ledgerSince: "When per-call logging started. Earlier spend came from the AI ledger, one row per lesson voiced or reply read, without provider ids.",
      matched: "true: the provider's log has this call. false: it doesn't (yet; logs can lag a few minutes). null: it can't be checked.",
      otherKeys: "The other API keys of the same ElevenLabs workspace or Deepgram project, for context: not the platform's spend. ElevenLabs' request log has no IP address or user agent, so a key is all that tells callers apart: give each place that calls it (the platform, the worker, the learning service, a PC) its own.",
      workloads: Object.entries(WORKLOADS).map(([key, entry]) => `${key}: ${entry.label}`).join("; "),
    },
  };
}

/** The charges as CSV: one row per call, with a header. */
export function chargesCsv(report: SpendReport): string {
  const columns: (keyof ChargeRow)[] = [
    "at",
    "provider",
    "workload",
    "model",
    "voiceLabel",
    "status",
    "characters",
    "credits",
    "creditsExact",
    "revoiced",
    "audioSeconds",
    "estimatedUsd",
    "billedUsd",
    "billedBasis",
    "matched",
    "requestId",
    "runtime",
    "courseTitle",
    "lessonCode",
    "lessonTitle",
    "userId",
    "userName",
    "backfilled",
  ];
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...report.charges.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\n") + "\n";
}
