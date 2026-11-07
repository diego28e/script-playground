import type { Content, GenerateContentConfig } from "@google/genai";

// DeepSeek V4.1 Flash (`deepseek-flash`), the tutor's last fallback after the free Gemini models. Its API is
// OpenAI-style (https://api-docs.deepseek.com); called with fetch, so it needs no SDK. Thinking is switched off:
// the tutor answers in seconds, and the free Gemini models before it do the same.

const BASE_URL = "https://api.deepseek.com";

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export type DeepSeekResult = {
  text: string;
  finishReason: string | null;
  tokens: { input: number; output: number; thoughts: number; total: number };
  /** The first answer came back blank in JSON mode and this is the retry without it (acceptProse). */
  retried?: boolean;
};

function systemText(config: GenerateContentConfig): string {
  const system = config.systemInstruction;
  if (!system) return "";
  if (typeof system === "string") return system;
  if ("parts" in system && Array.isArray(system.parts)) return system.parts.map((part) => part.text ?? "").join("");
  if ("text" in system && typeof system.text === "string") return system.text;
  return "";
}

/** Gemini-shaped contents and config, as one DeepSeek chat completion. */
export async function deepSeekGenerate(
  model: string,
  contents: Content[],
  config: GenerateContentConfig,
  signal: AbortSignal,
  options: {
    /** Follows the answer as it's written (the whole text so far): the request is then streamed. */
    onText?: (text: string) => void;
    /**
     * The caller takes a prose answer when JSON was asked for (the tutor shows it as the reply). JSON mode blanks an
     * answer that isn't JSON; with this, a blank one is asked again at once without JSON mode, rather than counted as
     * no answer and sent down the chain to slower models.
     */
    acceptProse?: boolean;
  } = {},
): Promise<DeepSeekResult> {
  const json = config.responseMimeType === "application/json";
  const answer = await complete(model, contents, config, signal, json, options.onText);
  if (!json || !options.acceptProse || answer.text) return answer;
  const retry = await complete(model, contents, config, signal, false, options.onText);
  // Both were billed.
  const tokens = {
    input: answer.tokens.input + retry.tokens.input,
    output: answer.tokens.output + retry.tokens.output,
    thoughts: 0,
    total: answer.tokens.total + retry.tokens.total,
  };
  return { ...retry, tokens, retried: true };
}

async function complete(
  model: string,
  contents: Content[],
  config: GenerateContentConfig,
  signal: AbortSignal,
  json: boolean,
  onText?: (text: string) => void,
): Promise<DeepSeekResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new DeepSeekError("DEEPSEEK_API_KEY is not set", 401);

  const messages = [
    ...(systemText(config) ? [{ role: "system", content: systemText(config) }] : []),
    ...contents.map((item) => ({
      role: item.role === "model" ? "assistant" : "user",
      content: (item.parts ?? []).map((part) => part.text ?? "").join("\n\n"),
    })),
  ];
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      thinking: { type: "disabled" },
      max_tokens: config.maxOutputTokens ?? 4096,
      // JSON Output needs the word "json" and an example in the prompt; the tutor's system prompt has both.
      ...(json ? { response_format: { type: "json_object" } } : {}),
      ...(onText ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DeepSeekError(`DeepSeek ${response.status}: ${body.slice(0, 300)}`, response.status);
  }
  if (onText) return readStream(response, onText);
  const data = (await response.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const choice = data.choices?.[0];
  return {
    // JSON Output replaces content it can't parse with spaces: blank means "no answer".
    text: (choice?.message?.content ?? "").trim(),
    finishReason: choice?.finish_reason ?? null,
    tokens: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      // completion_tokens already includes any reasoning tokens (none with thinking off): not counted twice.
      thoughts: 0,
      total: data.usage?.total_tokens ?? 0,
    },
  };
}

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

/** A streamed completion (server-sent events), passing on the text as it grows. */
async function readStream(response: Response, onText: (text: string) => void): Promise<DeepSeekResult> {
  if (!response.body) throw new DeepSeekError("DeepSeek sent no stream");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let usage: Usage = {};
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const event = JSON.parse(payload) as { choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; usage?: Usage };
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.delta?.content) {
        text += choice.delta.content;
        onText(text);
      }
    }
    if (done) break;
  }
  return {
    text: text.trim(),
    finishReason,
    tokens: { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0, thoughts: 0, total: usage.total_tokens ?? 0 },
  };
}
