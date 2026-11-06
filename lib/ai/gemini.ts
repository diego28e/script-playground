import { randomUUID } from "node:crypto";
import { ApiError, GoogleGenAI, type Content, type FunctionCall, type GenerateContentConfig, type ThinkingLevel } from "@google/genai";
import type { AiPool } from "@prisma/client";
import { checkQuota, finishRequest, startRequest } from "@/lib/ai/quota";
import { DeepSeekError, deepSeekGenerate } from "@/lib/ai/deepseek";

// Every Gemini call on the platform goes through generateWithFallback: one model chain, per-attempt timeouts, the
// free-tier quota (lib/ai/quota.ts: a model over its share is skipped, and every request is recorded in the
// ai_request ledger), and one structured log line per attempt plus one per call, all sharing a trace ID. Logs are JSON on stdout,
// which Amplify ships to CloudWatch (/aws/amplify/<app id>). They never contain prompts, code or answers.
// Only signed-in users reach this (actions/ai.ts checks), so every call line names who made it.
//
// CloudWatch Logs Insights queries (log group /aws/amplify/del16ro80clg0):
//   One call:           filter @message like /"traceId":"<id>"/
//   Who spends most:    filter @message like /"event":"ai.call"/ | stats count(*) as calls, sum(tokens.total) as tokens by userId | sort tokens desc
//   Spend by feature:   filter @message like /"event":"ai.call"/ | stats count(*) as calls, sum(tokens.total) as tokens by feature, model
//   Fallback rate:      filter @message like /"event":"ai.call"/ | stats count(*) by model, fallbackUsed
//   Refused (signed out or not allowed): filter @message like /"event":"ai.denied"/ | stats count(*) by feature, reason

export type ModelEntry = { model: string; timeoutMs: number; provider?: "gemini" | "deepseek" };

/**
 * Tried in order, spending the free tier first: on the free tier each model has its own daily allowance (20
 * requests on each Flash, 500 on each Flash-Lite), so every model in the chain adds a day's worth of requests.
 * The strongest first: gemini-3.8-flash is often busy (503 "high demand"), and that refusal is quick, so trying it
 * costs about a second. The Flash-Lite models draw on separate capacity and are usually up when the Flash models
 * are not. Checked with this project's key on 2026-11-05; gemini-2.5-* is closed to new keys (404).
 */
export const MODEL_CHAIN: ReadonlyArray<ModelEntry> = [
  { model: "gemini-3.8-flash", timeoutMs: 12_000 },
  { model: "gemini-3.6-flash", timeoutMs: 15_000 },
  { model: "gemini-3.1-flash-lite", timeoutMs: 12_000 },
  { model: "gemini-3.5-flash-lite", timeoutMs: 12_000 },
];

/**
 * The tutor's chain: the free Gemini models, then DeepSeek V4.1 Flash, paid but in the same class as Gemini 3.8
 * Flash, for when every free allowance is spent or Google is down (capped per day in lib/ai/quota.ts).
 */
export const TUTOR_CHAIN: ReadonlyArray<ModelEntry> = [...MODEL_CHAIN, { model: "deepseek-flash", timeoutMs: 20_000, provider: "deepseek" }];

export type AiFeature = "explain" | "ask" | "translate" | "tutor";

export type AiResult =
  | { ok: true; text: string; functionCalls: FunctionCall[]; model: string; traceId: string }
  | { ok: false; reason: "unavailable" | "blocked" | "misconfigured"; traceId: string }
  // Every model is over its share of the free tier: try again at `retryAt`.
  | { ok: false; reason: "quota"; retryAt: Date; traceId: string };

type Tokens = { input: number; output: number; thoughts: number; total: number };

type Attempt = {
  model: string;
  outcome: "ok" | "error" | "timeout" | "empty" | "blocked" | "quota";
  status?: number;
  latencyMs: number;
  /** Billed tokens, when the provider answered (failed and timed-out attempts usually bill nothing). */
  tokens?: Tokens;
};

// Worth trying the next model: the model is missing or retired, busy, slow, failing, or rejected a setting.
// Not worth it: the key itself is refused (401/403), which every model would refuse the same way.
function shouldFallBack(status: number | undefined) {
  return status === undefined || ![401, 403].includes(status);
}

// A model that timed out or answered 429/5xx is skipped for a while: Gemini 3.8 Flash, when overloaded, often hangs
// until our timeout rather than refusing at once, which would add that wait to every call. Per server process.
const COOL_DOWN_MS = 5 * 60_000;
const coolingUntil = new Map<string, number>();
function coolDown(model: string, timedOut: boolean, status: number | undefined) {
  if (timedOut || status === 429 || (status !== undefined && status >= 500)) coolingUntil.set(model, Date.now() + COOL_DOWN_MS);
}

export function logAi(level: "info" | "warn" | "error", entry: Record<string, unknown>) {
  console[level](JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
const log = logAi;

export async function generateWithFallback({
  feature,
  contents,
  config,
  userId,
  pool = "PLATFORM",
  models = MODEL_CHAIN,
}: {
  feature: AiFeature;
  contents: Content[];
  config: GenerateContentConfig;
  /** The signed-in user the call is for; it is how spend is traced back to people. */
  userId: string;
  /** Whose share of the free tier the call draws on: the tutor's or the platform's other features'. */
  pool?: AiPool;
  /** Override the chain, e.g. the tutor's (TUTOR_CHAIN). Defaults to MODEL_CHAIN. */
  models?: ReadonlyArray<ModelEntry>;
}): Promise<AiResult> {
  const traceId = randomUUID();
  const started = Date.now();
  const inputChars = contents.reduce((sum, item) => sum + (item.parts ?? []).reduce((n, part) => n + (part.text?.length ?? 0), 0), 0);
  const attempts: Attempt[] = [];

  const finish = (result: AiResult) => {
    log(result.ok ? "info" : "error", {
      event: "ai.call",
      traceId,
      feature,
      userId,
      outcome: result.ok ? "ok" : result.reason,
      model: result.ok ? result.model : null,
      fallbackUsed: result.ok ? result.model !== models[0]?.model : null,
      attempts: attempts.map((attempt) => `${attempt.model}:${attempt.outcome}${attempt.status ? `:${attempt.status}` : ""}`),
      totalMs: Date.now() - started,
      inputChars,
      // Summed over every attempt that billed, fallback included: what this call cost.
      tokens: attempts.reduce<Tokens>(
        (sum, attempt) => ({
          input: sum.input + (attempt.tokens?.input ?? 0),
          output: sum.output + (attempt.tokens?.output ?? 0),
          thoughts: sum.thoughts + (attempt.tokens?.thoughts ?? 0),
          total: sum.total + (attempt.tokens?.total ?? 0),
        }),
        { input: 0, output: 0, thoughts: 0, total: 0 },
      ),
    });
    return result;
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log("error", { event: "ai.config", traceId, feature, problem: "GEMINI_API_KEY is not set" });
    return finish({ ok: false, reason: "misconfigured", traceId });
  }
  const ai = new GoogleGenAI({ apiKey });

  // The earliest moment a skipped model frees up, for the learner's "try again at …".
  let retryAt: Date | null = null;
  // If every model is cooling down, try them all anyway: a cool-down is a guess, never a reason to fail.
  const allCooling = models.every(({ model }) => (coolingUntil.get(model) ?? 0) > Date.now());
  for (const [index, { model, timeoutMs, provider = "gemini" }] of models.entries()) {
    const attemptStarted = Date.now();
    if (!allCooling && (coolingUntil.get(model) ?? 0) > Date.now()) {
      log("info", { event: "ai.attempt", traceId, feature, attempt: index + 1, model, outcome: "cooling", userId });
      continue;
    }
    const quota = await checkQuota(model, pool, userId);
    if (!quota.ok) {
      attempts.push({ model, outcome: "quota", latencyMs: 0 });
      log("info", { event: "ai.attempt", traceId, feature, attempt: index + 1, model, outcome: "quota", limit: quota.reason, userId });
      if (!retryAt || quota.retryAt < retryAt) retryAt = quota.retryAt;
      // A person over their own daily count is over it on every model.
      if (quota.reason === "person") break;
      continue;
    }
    const requestId = await startRequest({ pool, feature, model, userId, traceId });
    let recorded = false;
    const record = (ok: boolean, tokens?: Tokens) => {
      recorded = true;
      return finishRequest(requestId, { ok, model, tokens }).catch((error) => log("warn", { event: "ai.ledger", traceId, error: String(error) }));
    };
    try {
      if (provider === "deepseek") {
        const answer = await deepSeekGenerate(model, contents, config, AbortSignal.timeout(timeoutMs));
        const outcome: Attempt["outcome"] = answer.text ? "ok" : "empty";
        attempts.push({ model, outcome, latencyMs: Date.now() - attemptStarted, tokens: answer.tokens });
        await record(outcome === "ok", answer.tokens);
        log(outcome === "ok" ? "info" : "warn", {
          event: "ai.attempt",
          traceId,
          feature,
          attempt: index + 1,
          model,
          outcome,
          finishReason: answer.finishReason,
          latencyMs: Date.now() - attemptStarted,
          userId,
          tokens: answer.tokens,
          outputChars: answer.text.length,
        });
        if (outcome === "ok") return finish({ ok: true, text: answer.text, functionCalls: [], model, traceId });
        continue;
      }
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          // Gemini 3 thinks before answering, and thinking counts against maxOutputTokens: with the default
          // level an explanation was cut off after a few lines. MINIMAL returns the whole answer, and every
          // model in the chain accepts it (thinkingBudget: 0 is rejected by some). @google/genai 1.30's enum
          // predates MINIMAL; the API takes the string as is.
          thinkingConfig: { thinkingLevel: "MINIMAL" as ThinkingLevel },
          ...config,
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });
      const candidate = response.candidates?.[0];
      const usage = response.usageMetadata;
      // Text parts only: response.text also warns when the reply holds function calls.
      const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");
      const functionCalls = response.functionCalls ?? [];
      const blocked = candidate?.finishReason === "SAFETY" || Boolean(response.promptFeedback?.blockReason);
      const outcome: Attempt["outcome"] = blocked ? "blocked" : text || functionCalls.length ? "ok" : "empty";
      const tokens: Tokens = {
        input: usage?.promptTokenCount ?? 0,
        output: usage?.candidatesTokenCount ?? 0,
        thoughts: usage?.thoughtsTokenCount ?? 0,
        total: usage?.totalTokenCount ?? 0,
      };
      attempts.push({ model, outcome, latencyMs: Date.now() - attemptStarted, tokens });
      await record(outcome === "ok", tokens);
      log(outcome === "ok" ? "info" : "warn", {
        event: "ai.attempt",
        traceId,
        feature,
        attempt: index + 1,
        model,
        outcome,
        finishReason: candidate?.finishReason ?? null,
        latencyMs: Date.now() - attemptStarted,
        userId,
        tokens,
        outputChars: text.length,
      });
      if (outcome === "ok") return finish({ ok: true, text, functionCalls, model, traceId });
      // A safety block would repeat on the next model; an empty answer might not.
      if (outcome === "blocked") return finish({ ok: false, reason: "blocked", traceId });
    } catch (error) {
      // Our per-attempt timeout aborts the request; the SDK rethrows it as "exception AbortError: … aborted".
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError" || /AbortError|aborted/i.test(error.message));
      const status = error instanceof ApiError || error instanceof DeepSeekError ? error.status : undefined;
      attempts.push({ model, outcome: timedOut ? "timeout" : "error", status, latencyMs: Date.now() - attemptStarted });
      if (!recorded) await record(false);
      coolDown(model, timedOut, status);
      log("warn", {
        event: "ai.attempt",
        traceId,
        feature,
        attempt: index + 1,
        userId,
        model,
        outcome: timedOut ? "timeout" : "error",
        status: status ?? null,
        latencyMs: Date.now() - attemptStarted,
        // The provider's message (e.g. "high demand", "no longer available"), without the request.
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
      if (!timedOut && !shouldFallBack(status)) break;
    }
  }
  // Every model skipped for quota (none was even tried): say when the tutor or feature is back.
  if (retryAt && attempts.every((attempt) => attempt.outcome === "quota")) return finish({ ok: false, reason: "quota", retryAt, traceId });
  return finish({ ok: false, reason: "unavailable", traceId });
}
