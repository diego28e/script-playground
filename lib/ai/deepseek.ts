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

export type DeepSeekResult = { text: string; finishReason: string | null; tokens: { input: number; output: number; thoughts: number; total: number } };

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
  const json = config.responseMimeType === "application/json";
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
    }),
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DeepSeekError(`DeepSeek ${response.status}: ${body.slice(0, 300)}`, response.status);
  }
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
