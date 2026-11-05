"use server";

import { headers } from "next/headers";
import { HarmBlockThreshold, HarmCategory } from "@google/genai";
import { encode } from "@toon-format/toon";
import { auth } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { generateWithFallback, logAi, type AiFeature, type AiResult } from "@/lib/ai/gemini";

type FailureReason = Exclude<AiResult, { ok: true }>["reason"] | "unauthenticated" | "forbidden";
export type AiResponse = { success: true; text: string } | { success: false; reason: FailureReason; error: string; traceId: string };

// What the student or admin reads. The details (status, model, provider message) are in the server log
// under the same trace ID.
const MESSAGES: Record<FailureReason, string> = {
  unavailable: "The AI assistant isn't available right now. Try again in a few minutes.",
  blocked: "The AI assistant can't answer that request. Try rephrasing it.",
  misconfigured: "The AI assistant isn't set up yet.",
  unauthenticated: "Sign in to use the AI assistant.",
  forbidden: "Only admins can use AI translation.",
};

function toResponse(result: AiResult): AiResponse {
  return result.ok
    ? { success: true, text: result.text }
    : { success: false, reason: result.reason, error: MESSAGES[result.reason], traceId: result.traceId };
}

/**
 * AI calls cost money, so each one must belong to a signed-in user (and translation to an admin). This runs
 * before any request to Gemini; a refusal is logged ("ai.denied") and costs nothing.
 */
async function authorize(feature: AiFeature, { admin = false } = {}): Promise<{ userId: string } | AiResponse> {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const reason: FailureReason | null = !session ? "unauthenticated" : admin && session.user.role !== "ADMIN" ? "forbidden" : null;
  if (!reason) return { userId: session!.user.id };
  const traceId = randomUUID();
  logAi("warn", { event: "ai.denied", traceId, feature, reason, userId: session?.user.id ?? null });
  return { success: false, reason, error: MESSAGES[reason], traceId };
}

export async function generateAIResponse(
  code: string,
  challengeDescription: string,
  mode: "explain" | "ask",
  userQuestion?: string,
  userLanguage: string = "Spanish"
): Promise<AiResponse> {
  const caller = await authorize(mode);
  if (!("userId" in caller)) return caller;

  const systemInstructionText =
    mode === "explain"
      ? `Explain the code snippet line by line, focusing on how the compiler/interpreter processes each executable statement step by step. Ignore all comments in the code - do not mention or explain them since the compiler ignores them. Only narrate what the compiler actually does with each line of executable code. Make it human-friendly so the learner thinks like the compiler and understands the syntax. Respond in ${userLanguage}.`
      : `You are an expert coding assistant. Answer the user's question about the provided code. Respond in ${userLanguage}.`;

  // TOON keeps the structured input compact (fewer tokens than JSON).
  const encodedInput = encode({
    code,
    challengeDescription,
    userLanguage,
    ...(userQuestion && { userQuestion }),
  });

  const result = await generateWithFallback({
    feature: mode,
    userId: caller.userId,
    contents: [{ role: "user", parts: [{ text: encodedInput }] }],
    config: {
      temperature: 0.4,
      topP: 0.85,
      // A full line-by-line explanation measured about 800 tokens; 2048 leaves room without cutting off.
      maxOutputTokens: 2048,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
      ],
      systemInstruction: [{ text: systemInstructionText }],
    },
  });
  return toResponse(result);
}

export async function translateContent(text: string, targetLanguage: string): Promise<AiResponse> {
  const caller = await authorize("translate", { admin: true });
  if (!("userId" in caller)) return caller;

  const systemInstruction = `You are a technical translator. The input is HTML markup. Translate ONLY the text content to ${targetLanguage} while preserving ALL HTML tags exactly as they appear (<p>, <ul>, <li>, <code>, <strong>, etc.). Do not convert HTML to markdown. Do not add asterisks or numbered lists. Keep the exact same HTML structure. Keep all code snippets, function names, and variable names untranslated. Return the HTML with translated text but identical structure.`;

  const result = await generateWithFallback({
    feature: "translate",
    userId: caller.userId,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      temperature: 0.2,
      // A translation is about as long as its source; challenge descriptions can be long HTML.
      maxOutputTokens: 8192,
      systemInstruction: [{ text: systemInstruction }],
    },
  });
  return toResponse(result);
}
