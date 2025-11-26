"use server";

import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import { encode } from "@toon-format/toon";

export async function generateAIResponse(
  code: string,
  challengeDescription: string,
  mode: "explain" | "ask",
  userQuestion?: string,
  userLanguage: string = "Spanish"
) {
  if (!process.env.GEMINI_API_KEY) {
    return { success: false, error: "GEMINI_API_KEY is not set" };
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const systemInstructionText =
    mode === "explain"
      ? `Explain the code snippet line by line, focusing on how the compiler/interpreter processes each executable statement step by step. Ignore all comments in the code - do not mention or explain them since the compiler ignores them. Only narrate what the compiler actually does with each line of executable code. Make it human-friendly so the learner thinks like the compiler and understands the syntax. Respond in ${userLanguage}.`
      : `You are an expert coding assistant. Answer the user's question about the provided code. Respond in ${userLanguage}.`;

  const config = {
    temperature: 0.4,
    topP: 0.85,
    maxOutputTokens: 1200,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
    ],
    systemInstruction: [
      {
        text: systemInstructionText,
      },
    ],
  };

  const model = "gemini-2.0-flash-lite";

  const inputData = {
    code,
    challengeDescription,
    userLanguage,
    ...(userQuestion && { userQuestion }),
  };

  // Use TOON to encode the input for token efficiency
  const encodedInput = encode(inputData);

  const contents = [
    {
      role: "user",
      parts: [
        {
          text: encodedInput,
        },
      ],
    },
  ];

  try {
    const response = await ai.models.generateContent({
      model,
      config,
      contents,
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { success: true, text };
  } catch (error: any) {
    console.error("AI Error:", error);
    return {
      success: false,
      error: error.message || "Failed to generate response",
    };
  }
}

export async function translateContent(text: string, targetLanguage: string) {
  if (!process.env.GEMINI_API_KEY) {
    return { success: false, error: "GEMINI_API_KEY is not set" };
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const model = "gemini-2.0-flash-lite";
  const systemInstruction = `You are a technical translator. The input is HTML markup. Translate ONLY the text content to ${targetLanguage} while preserving ALL HTML tags exactly as they appear (<p>, <ul>, <li>, <code>, <strong>, etc.). Do not convert HTML to markdown. Do not add asterisks or numbered lists. Keep the exact same HTML structure. Keep all code snippets, function names, and variable names untranslated. Return the HTML with translated text but identical structure.`;

  try {
    const response = await ai.models.generateContent({
      model,
      config: {
        temperature: 0.2,
        systemInstruction: [{ text: systemInstruction }],
      },
      contents: [{ role: "user", parts: [{ text }] }],
    });

    const translatedText =
      response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { success: true, text: translatedText };
  } catch (error: any) {
    console.error("Translation Error:", error);
    return {
      success: false,
      error: error.message || "Failed to translate content",
    };
  }
}
