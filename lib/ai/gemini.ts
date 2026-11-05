import { randomUUID } from "node:crypto";
import { ApiError, GoogleGenAI, type Content, type GenerateContentConfig, type ThinkingLevel } from "@google/genai";

// Every Gemini call on the platform goes through generateWithFallback: one model chain, per-attempt timeouts,
// and one structured log line per attempt plus one per call, all sharing a trace ID. Logs are JSON on stdout,
// which Amplify ships to CloudWatch (/aws/amplify/<app id>). They never contain prompts, code or answers.
//
// Find a call:   filter @message like /"traceId":"<id>"/
// Fallback rate: filter @message like /"event":"ai.call"/ | stats count(*) by model, fallbackUsed

/**
 * Tried in order. The primary is the newest Flash model; the fallback is an older, lighter generation that
 * draws on separate capacity, so it is usually up when the new models return 503 "high demand".
 * Checked with this project's key on 2026-11-05: gemini-3.1-flash-lite answered 3 of 3 in 2-4 s while
 * gemini-3.5-flash and gemini-3.5-flash-lite returned 503, and gemini-2.5-* is closed to new keys (404).
 */
export const MODEL_CHAIN = [
  { model: "gemini-3.6-flash", timeoutMs: 15_000 },
  { model: "gemini-3.1-flash-lite", timeoutMs: 12_000 },
] as const;

export type AiFeature = "explain" | "ask" | "translate";

export type AiResult =
  | { ok: true; text: string; model: string; traceId: string }
  | { ok: false; reason: "unavailable" | "blocked" | "misconfigured"; traceId: string };

type Attempt = {
  model: string;
  outcome: "ok" | "error" | "timeout" | "empty" | "blocked";
  status?: number;
  latencyMs: number;
};

// Worth trying the next model: the model is missing or retired, busy, slow, failing, or rejected a setting.
// Not worth it: the key itself is refused (401/403), which every model would refuse the same way.
function shouldFallBack(status: number | undefined) {
  return status === undefined || ![401, 403].includes(status);
}

function log(level: "info" | "warn" | "error", entry: Record<string, unknown>) {
  console[level](JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

export async function generateWithFallback({
  feature,
  contents,
  config,
  userId,
  models = MODEL_CHAIN,
}: {
  feature: AiFeature;
  contents: Content[];
  config: GenerateContentConfig;
  userId?: string | null;
  /** Override the chain, e.g. a feature that needs a stronger model. Defaults to MODEL_CHAIN. */
  models?: ReadonlyArray<{ model: string; timeoutMs: number }>;
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
      userId: userId ?? null,
      outcome: result.ok ? "ok" : result.reason,
      model: result.ok ? result.model : null,
      fallbackUsed: result.ok ? result.model !== models[0]?.model : null,
      attempts: attempts.map((attempt) => `${attempt.model}:${attempt.outcome}${attempt.status ? `:${attempt.status}` : ""}`),
      totalMs: Date.now() - started,
      inputChars,
    });
    return result;
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log("error", { event: "ai.config", traceId, feature, problem: "GEMINI_API_KEY is not set" });
    return finish({ ok: false, reason: "misconfigured", traceId });
  }
  const ai = new GoogleGenAI({ apiKey });

  for (const [index, { model, timeoutMs }] of models.entries()) {
    const attemptStarted = Date.now();
    try {
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
      const text = response.text ?? "";
      const blocked = candidate?.finishReason === "SAFETY" || Boolean(response.promptFeedback?.blockReason);
      const outcome: Attempt["outcome"] = blocked ? "blocked" : text ? "ok" : "empty";
      attempts.push({ model, outcome, latencyMs: Date.now() - attemptStarted });
      log(outcome === "ok" ? "info" : "warn", {
        event: "ai.attempt",
        traceId,
        feature,
        attempt: index + 1,
        model,
        outcome,
        finishReason: candidate?.finishReason ?? null,
        latencyMs: Date.now() - attemptStarted,
        tokens: {
          input: usage?.promptTokenCount ?? null,
          output: usage?.candidatesTokenCount ?? null,
          thoughts: usage?.thoughtsTokenCount ?? null,
          total: usage?.totalTokenCount ?? null,
        },
        outputChars: text.length,
      });
      if (outcome === "ok") return finish({ ok: true, text, model, traceId });
      // A safety block would repeat on the next model; an empty answer might not.
      if (outcome === "blocked") return finish({ ok: false, reason: "blocked", traceId });
    } catch (error) {
      // Our per-attempt timeout aborts the request; the SDK rethrows it as "exception AbortError: … aborted".
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError" || /AbortError|aborted/i.test(error.message));
      const status = error instanceof ApiError ? error.status : undefined;
      attempts.push({ model, outcome: timedOut ? "timeout" : "error", status, latencyMs: Date.now() - attemptStarted });
      log("warn", {
        event: "ai.attempt",
        traceId,
        feature,
        attempt: index + 1,
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
  return finish({ ok: false, reason: "unavailable", traceId });
}
