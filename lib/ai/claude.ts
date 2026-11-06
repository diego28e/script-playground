import Anthropic from "@anthropic-ai/sdk";
import type { Content, GenerateContentConfig, Schema } from "@google/genai";

// Claude (Anthropic's API) as a provider in the AI chain (lib/ai/gemini.ts), for admins' authoring work: drafting
// the practice skill graph (lib/practice/draft.ts). Called through the official SDK with structured outputs, so a
// JSON answer always matches the schema. Claude Opus 5.5 and Sonnet 5.5 always think; effort sets how much.

const API_URL = "https://api.anthropic.com";

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

export type ClaudeResult = { text: string; finishReason: string | null; tokens: { input: number; output: number; thoughts: number; total: number } };

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClaudeError("ANTHROPIC_API_KEY is not set", 401);
  // The official endpoint, named explicitly: a stray ANTHROPIC_BASE_URL in a shell must never receive the key. No
  // SDK retries: the chain moves to the next model instead.
  client ??= new Anthropic({ apiKey, baseURL: API_URL, maxRetries: 0 });
  return client;
}

function systemText(config: GenerateContentConfig): string {
  const system = config.systemInstruction;
  if (!system) return "";
  if (typeof system === "string") return system;
  if ("parts" in system && Array.isArray(system.parts)) return system.parts.map((part) => part.text ?? "").join("");
  if ("text" in system && typeof system.text === "string") return system.text;
  return "";
}

/**
 * A Gemini response schema as the JSON Schema Claude's structured outputs take: lowercase types, every object closed
 * (`additionalProperties: false`, which structured outputs require), Gemini-only keys dropped.
 */
export function toJsonSchema(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type) out.type = String(schema.type).toLowerCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toJsonSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toJsonSchema(value)]));
    out.required = schema.required ?? [];
    out.additionalProperties = false;
  }
  return out;
}

/** Gemini-shaped contents and config, as one Claude message (streamed, so a long answer never hits a request timeout). */
export async function claudeGenerate(model: string, contents: Content[], config: GenerateContentConfig, signal: AbortSignal): Promise<ClaudeResult> {
  const messages: Anthropic.MessageParam[] = contents.map((item) => ({
    role: item.role === "model" ? "assistant" : "user",
    content: (item.parts ?? []).map((part) => part.text ?? "").join("\n\n"),
  }));
  const schema = config.responseMimeType === "application/json" && config.responseSchema ? toJsonSchema(config.responseSchema as Schema) : null;
  try {
    const stream = anthropic().messages.stream(
      {
        model,
        // Thinking counts toward max_tokens: leave room for it on top of the answer.
        max_tokens: Math.max(config.maxOutputTokens ?? 0, 16_000),
        system: systemText(config) || undefined,
        messages,
        output_config: {
          // Drafting is a bounded task; low effort keeps a lesson well inside the 30 s an Amplify request may run.
          effort: "low",
          ...(schema ? { format: { type: "json_schema", schema } } : {}),
        },
      },
      { signal },
    );
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new ClaudeError(`Claude declined (${message.stop_details?.category ?? "no category"})`, 400);
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const input = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    // output_tokens already includes thinking, billed as output.
    const output = message.usage.output_tokens;
    return { text, finishReason: message.stop_reason, tokens: { input, output, thoughts: 0, total: input + output } };
  } catch (error) {
    if (error instanceof ClaudeError) throw error;
    if (error instanceof Anthropic.APIError) throw new ClaudeError(error.message, error.status ?? undefined);
    throw error;
  }
}
