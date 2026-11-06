import type { AiPool } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// The platform's Gemini key belongs to the project "script-builder", which is on the Gemini API's free tier. Its
// limits are per project, so the tutor and the platform's other AI features draw on one pool. This module keeps
// our own count of requests (the ai_request table) so that:
//   - a learner gets a clear "the tutor is resting until …" instead of Google's 429;
//   - the tutor and the other features each keep a share of the day;
//   - if billing is ever linked, use stays at free-tier levels, which caps the cost.
// Google remains the final judge (local development uses the same key with a separate database, so the two counts
// can drift); a 429 from Google still falls through to the next model.

/**
 * Limits per model. Gemini's are the free tier's, from AI Studio's Rate limit page for script-builder, read on
 * 2026-11-05. DeepSeek has no free tier: its limit is our own cap on a paid fallback, for the tutor only.
 */
export const MODEL_LIMITS: Record<string, { rpm: number; rpd: number }> = {
  "gemini-3.8-flash": { rpm: 5, rpd: 20 },
  "gemini-3.6-flash": { rpm: 5, rpd: 20 },
  "gemini-3.1-flash-lite": { rpm: 15, rpd: 500 },
  "gemini-3.5-flash-lite": { rpm: 15, rpd: 500 },
  // About US$0.50 a day at peak rates for the tutor's usual turn (about 7,000 tokens in, 400 out).
  "deepseek-flash": { rpm: 60, rpd: 200 },
};

/** What the platform's other features keep of each model's day; the tutor gets the rest (all of DeepSeek's). */
const PLATFORM_RESERVE: Record<string, number> = {
  "gemini-3.8-flash": 5,
  "gemini-3.6-flash": 5,
  "gemini-3.1-flash-lite": 50,
  "gemini-3.5-flash-lite": 50,
};

/** Requests a day for each person, in the platform's other features. The tutor has no per-person count: its share is. */
export const PLATFORM_PER_USER_DAILY = 10;

/** Paid prices per 1M tokens, USD (Google's and DeepSeek's pricing pages, 2026-11-05). Thinking is billed as output. */
const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  // Peak price; off-peak is half (deepSeekPeak). Input at the cache-miss price, so this is an upper bound.
  "deepseek-flash": { input: 0.3, output: 1.2 },
};

/** DeepSeek's peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. Everything else is half price. */
export function deepSeekPeak(at = new Date()): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

export function listCostMicros(model: string, tokens: { input: number; output: number; thoughts: number }, at = new Date()): number {
  const price = PRICES[model];
  if (!price) return 0;
  const factor = model.startsWith("deepseek") && !deepSeekPeak(at) ? 0.5 : 1;
  return Math.round((tokens.input * price.input + (tokens.output + tokens.thoughts) * price.output) * factor);
}

/** The Pacific date, YYYY-MM-DD: Google resets daily quotas at midnight Pacific time. */
export function pacificDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** When the current Pacific day ends. */
export function nextPacificMidnight(at = new Date()): Date {
  const day = pacificDay(at);
  // Step forward an hour at a time until the Pacific date changes: simple, and right across daylight-saving days.
  let probe = new Date(at);
  probe.setUTCMinutes(0, 0, 0);
  while (pacificDay(probe) === day) probe = new Date(probe.getTime() + 3600_000);
  // Back to the first minute of the new day.
  while (pacificDay(new Date(probe.getTime() - 60_000)) !== day) probe = new Date(probe.getTime() - 60_000);
  return probe;
}

function poolShare(model: string, pool: AiPool): number {
  const limit = MODEL_LIMITS[model];
  if (!limit) return 0;
  const reserve = Math.min(PLATFORM_RESERVE[model] ?? 0, limit.rpd);
  return pool === "PLATFORM" ? reserve : limit.rpd - reserve;
}

export type QuotaCheck = { ok: true } | { ok: false; reason: "minute" | "day" | "person"; retryAt: Date };

/** Whether `model` can take one more request now, for `pool` (and, for the platform pool, for `userId`). */
export async function checkQuota(model: string, pool: AiPool, userId: string | null, at = new Date()): Promise<QuotaCheck> {
  const limit = MODEL_LIMITS[model];
  if (!limit) return { ok: false, reason: "day", retryAt: nextPacificMidnight(at) };
  const day = pacificDay(at);
  const minuteAgo = new Date(at.getTime() - 60_000);
  const notFailed = { not: "FAILED" as const };
  const [lastMinute, poolToday, personToday] = await Promise.all([
    // Per minute, Google counts the whole project.
    prisma.aiRequest.count({ where: { model, createdAt: { gt: minuteAgo }, status: notFailed } }),
    prisma.aiRequest.count({ where: { model, pool, day, status: notFailed } }),
    pool === "PLATFORM" && userId ? prisma.aiRequest.count({ where: { pool, userId, day, status: notFailed } }) : Promise.resolve(0),
  ]);
  if (pool === "PLATFORM" && userId && personToday >= PLATFORM_PER_USER_DAILY) {
    return { ok: false, reason: "person", retryAt: nextPacificMidnight(at) };
  }
  if (poolToday >= poolShare(model, pool)) return { ok: false, reason: "day", retryAt: nextPacificMidnight(at) };
  if (lastMinute >= limit.rpm) return { ok: false, reason: "minute", retryAt: new Date(at.getTime() + 60_000) };
  return { ok: true };
}

/** Counts a request before it is sent, so two calls at once can't both take the last slot. */
export async function startRequest(input: { pool: AiPool; feature: string; model: string; userId: string | null; traceId: string }) {
  const row = await prisma.aiRequest.create({ data: { ...input, day: pacificDay() }, select: { id: true } });
  return row.id;
}

export async function finishRequest(
  id: string,
  outcome: { ok: boolean; model: string; tokens?: { input: number; output: number; thoughts: number } },
) {
  const tokens = outcome.tokens ?? { input: 0, output: 0, thoughts: 0 };
  await prisma.aiRequest.update({
    where: { id },
    data: {
      // A request Google refused without billing (429, 5xx before any output) does not count against the day.
      status: outcome.ok || tokens.input > 0 ? "OK" : "FAILED",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      thoughtTokens: tokens.thoughts,
      listCostMicros: listCostMicros(outcome.model, tokens),
    },
  });
}
