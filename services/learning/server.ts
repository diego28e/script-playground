import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { z } from "zod";
import { logAi } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { getTutorSession, recordPractice, runTutorTurn, setTutorMode } from "@/lib/tutor/harness";
import { canListen, canSpeak, LISTEN_MAX_MINUTES, recordListen, recordSpeak } from "@/lib/voice/allowance";
import { listenGrant, SPEAK_MAX_CHARS, SPEAK_SAMPLE_RATE, speakStream, voiceConfigured } from "@/lib/voice/deepgram";
import { readPass } from "@/lib/lesson-tutor/pass";
import { runLessonTurn } from "@/lib/lesson-tutor/turn";
import { canSpeakLesson, lessonVoice, speakLesson, SPEAK_MAX_CHARS as LESSON_SPEAK_MAX_CHARS } from "@/lib/lesson-tutor/speak";

// The learning service: the AI tutor's backend, beside the lab hub on the server (docs/ai-tutor.md). It is not
// published to the internet: it listens on the lab's Docker network, and only the learners' Jupyter servers call
// it, through the academia_tutor server extension (infra/lab/tutor). Each request carries the token JupyterHub
// gave that learner's server; the service asks the hub whose token it is, so a learner can only be themselves.
//
//   POST /v1/turn       a tutor turn (lib/tutor/harness.ts runTutorTurn); with "stream": true, lines of JSON as the
//                       reply is written ({type: delta | reset}), then {type: done, result}
//   GET  /v1/session    the panel's state on opening: mode, and the session for ?notebookPath=
//   PUT  /v1/mode       Guide me / Show me
//   POST /v1/practice   "practise this in a few days" after a detour
//   POST /v1/voice/listen   a temporary grant for the panel's microphone stream (docs/voice.md)
//   POST /v1/voice/speak    a reply read aloud: raw PCM (SPEAK_SAMPLE_RATE), streamed as Deepgram makes it
//   GET  /healthz       for Docker's healthcheck
//
// And the lesson tutor (docs/lesson-tutor.md), the one part published to the internet: nginx passes the lab domain's
// /learning/v1/lesson/ here, for learners' browsers on the platform. Those requests carry a pass the platform signed
// with LESSON_TUTOR_SECRET (lib/lesson-tutor/pass.ts) instead of a hub token, and are answered with CORS headers for
// the platform's origins (LESSON_TUTOR_ORIGINS).
//   POST /v1/lesson/listen   a grant for the microphone stream
//   POST /v1/lesson/turn     a question: lines of JSON as the answer is written ({type: delta | reset}), then {type: done}
//   POST /v1/lesson/speak    an answer read aloud in the lesson's voice: raw PCM (SPEAK_SAMPLE_RATE), streamed

const PORT = Number(process.env.PORT ?? 8080);
const HUB_API_URL = (process.env.HUB_API_URL ?? "http://jupyterhub:8081/hub/api").replace(/\/+$/, "");
const MAX_BODY = 2 * 1024 * 1024;

type Learner = { userId: string; email: string };

// Hub answers are cached briefly: a learner's turn makes one hub call at most every few minutes.
const identities = new Map<string, { learner: Learner | null; until: number }>();
const IDENTITY_TTL_MS = 5 * 60_000;

async function identify(request: IncomingMessage): Promise<Learner | null> {
  const header = request.headers.authorization ?? "";
  const token = header.match(/^token\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const cached = identities.get(token);
  if (cached && cached.until > Date.now()) return cached.learner;

  let learner: Learner | null = null;
  const response = await fetch(`${HUB_API_URL}/user`, { headers: { Authorization: `token ${token}` }, signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (response?.ok) {
    const owner = (await response.json()) as { kind?: string; name?: string };
    // The token of a learner's server identifies its owner; the hub's usernames are platform emails.
    if (owner.kind === "user" && owner.name) {
      const user = await prisma.user.findUnique({ where: { email: owner.name.toLowerCase() }, select: { id: true, email: true } });
      if (user) learner = { userId: user.id, email: user.email };
    }
  }
  identities.set(token, { learner, until: Date.now() + (learner ? IDENTITY_TTL_MS : 30_000) });
  if (identities.size > 1000) identities.delete(identities.keys().next().value as string);
  return learner;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

const PracticeSchema = z.object({ sessionId: z.string().min(1), skill: z.string().min(1).max(200), evidence: z.enum(["PASSED", "SKIPPED", "REQUESTED"]) });
const ModeSchema = z.object({ mode: z.enum(["GUIDE", "SHOW"]) });
const ListenSchema = z.object({ mode: z.enum(["conversation", "dictation"]).default("conversation"), language: z.enum(["es", "en"]).default("es") });
const SpeakSchema = z.object({ text: z.string().trim().min(1).max(SPEAK_MAX_CHARS), language: z.enum(["es", "en"]).default("es") });
const LessonListenSchema = z.object({ language: z.enum(["es", "en"]).default("es") });
const LessonSpeakSchema = z.object({ text: z.string().trim().min(1).max(LESSON_SPEAK_MAX_CHARS), language: z.enum(["es", "en"]).default("es") });

const LESSON_PREFIX = "/v1/lesson/";
const ORIGINS = (process.env.LESSON_TUTOR_ORIGINS ?? "https://academiadelcodigo.com,https://www.academiadelcodigo.com")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** The CORS headers for a platform origin; none for any other, so a browser elsewhere can't read an answer. */
function allowOrigin(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (!origin || !ORIGINS.includes(origin)) return;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
}

/** The lesson tutor's routes: the learner and the lesson come from the pass, never from the body. */
async function handleLesson(request: IncomingMessage, response: ServerResponse, path: string) {
  allowOrigin(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    return response.end();
  }
  const secret = process.env.LESSON_TUTOR_SECRET;
  if (!secret) return send(response, 503, { ok: false, reason: "unavailable", message: "The lesson tutor isn't set up on this lab." });
  const pass = readPass(secret, (request.headers.authorization ?? "").match(/^pass\s+(\S+)$/i)?.[1] ?? "");
  if (!pass) return send(response, 401, { ok: false, reason: "unauthenticated", message: "The pass is missing or has expired. Reload the page." });
  if (request.method !== "POST") return send(response, 405, { ok: false, message: "Use POST." });

  if (path === "listen") {
    if (!voiceConfigured()) return send(response, 503, { ok: false, reason: "unavailable", message: "Voice isn't set up on this lab." });
    const parsed = LessonListenSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400, { ok: false, message: "language is invalid." });
    if (!(await canListen(pass.userId))) return send(response, 429, { ok: false, reason: "voice-limit", message: "You've used today's microphone time." });
    const grant = await listenGrant("conversation", parsed.data.language, "lesson-tutor.listen");
    await recordListen(pass.userId, "conversation", "lesson-tutor-voice", "lesson-tutor.listen");
    return send(response, 200, { ok: true, grant, maxMinutes: LISTEN_MAX_MINUTES });
  }
  if (path === "turn") {
    const body = await readJson(request);
    response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const line = (event: unknown) => {
      if (!response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
    };
    const result = await runLessonTurn(pass.userId, pass.lessonId, body as never, line).catch((error: Error) => {
      logAi("error", { event: "learning.error", path: request.url, error: String(error.stack ?? error).slice(0, 1000) });
      return { ok: false as const, reason: "unavailable" as const, message: "The teacher had a problem. Try again." };
    });
    line({ type: "done", result });
    return response.end();
  }
  if (path === "speak") {
    if (!voiceConfigured() && !process.env.ELEVENLABS_API_KEY) return send(response, 503, { ok: false, reason: "unavailable", message: "Voice isn't set up on this lab." });
    const parsed = LessonSpeakSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400, { ok: false, message: "text (at most 1,900 characters) and language are required." });
    if (!(await canSpeakLesson(pass.userId, parsed.data.text.length))) return send(response, 429, { ok: false, reason: "voice-limit", message: "You've used today's reading aloud." });
    const listener = new AbortController();
    response.on("close", () => listener.abort());
    const audio = await speakLesson(parsed.data.text, await lessonVoice(pass.lessonId), parsed.data.language, listener.signal, { userId: pass.userId, lessonId: pass.lessonId });
    response.writeHead(200, { "Content-Type": `audio/pcm;rate=${SPEAK_SAMPLE_RATE}`, "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    await pipeline(Readable.fromWeb(audio as NodeReadableStream<Uint8Array>), response).catch(() => {
      // Stopped by the listener, or the stream broke off: what was sent was played.
    });
    return;
  }
  return send(response, 404, { ok: false, message: "Not found." });
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://learning");
  if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { ok: true });
  if (url.pathname.startsWith(LESSON_PREFIX)) return handleLesson(request, response, url.pathname.slice(LESSON_PREFIX.length));

  const learner = await identify(request);
  if (!learner) return send(response, 401, { ok: false, reason: "unauthenticated", message: "The lab couldn't confirm who you are." });

  if (request.method === "POST" && url.pathname === "/v1/turn") {
    const body = (await readJson(request)) as { stream?: boolean };
    if (body.stream === true) {
      // The reply as the model writes it: the panel shows it and reads it aloud as it comes (docs/voice.md).
      response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      const line = (event: unknown) => {
        if (!response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
      };
      const result = await runTutorTurn(learner.userId, body as never, line).catch((error: Error) => {
        logAi("error", { event: "learning.error", path: request.url, error: String(error.stack ?? error).slice(0, 1000) });
        return { ok: false as const, reason: "unavailable" as const, message: "The tutor had a problem. Try again." };
      });
      line({ type: "done", result });
      return response.end();
    }
    const result = await runTutorTurn(learner.userId, body as never);
    const status = result.ok ? 200 : result.reason === "invalid" ? 400 : result.reason === "no-lab-access" ? 403 : result.reason === "quota" ? 429 : 503;
    return send(response, status, result);
  }
  if (request.method === "GET" && url.pathname === "/v1/session") {
    const notebookPath = url.searchParams.get("notebookPath");
    if (!notebookPath) return send(response, 400, { ok: false, message: "notebookPath is required." });
    return send(response, 200, { ok: true, ...(await getTutorSession(learner.userId, notebookPath)) });
  }
  if (request.method === "PUT" && url.pathname === "/v1/mode") {
    const parsed = ModeSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400, { ok: false, message: "mode must be GUIDE or SHOW." });
    await setTutorMode(learner.userId, parsed.data.mode);
    return send(response, 200, { ok: true, mode: parsed.data.mode });
  }
  if (request.method === "POST" && url.pathname === "/v1/practice") {
    const parsed = PracticeSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400, { ok: false, message: "sessionId, skill and evidence are required." });
    const result = await recordPractice(learner.userId, parsed.data.sessionId, parsed.data.skill, parsed.data.evidence);
    return send(response, result.ok ? 200 : 404, result);
  }
  if (request.method === "POST" && url.pathname === "/v1/voice/listen") {
    if (!voiceConfigured()) return send(response, 503, { ok: false, reason: "unavailable", message: "Voice isn't set up on this lab." });
    const parsed = ListenSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400, { ok: false, message: "mode and language are invalid." });
    if (!(await canListen(learner.userId))) return send(response, 429, { ok: false, reason: "voice-limit", message: "You've used today's microphone time." });
    const grant = await listenGrant(parsed.data.mode, parsed.data.language);
    await recordListen(learner.userId, parsed.data.mode, "tutor-voice");
    return send(response, 200, { ok: true, grant, maxMinutes: LISTEN_MAX_MINUTES });
  }
  if (request.method === "POST" && url.pathname === "/v1/voice/speak") {
    if (!voiceConfigured()) return send(response, 503, { ok: false, reason: "unavailable", message: "Voice isn't set up on this lab." });
    const parsed = SpeakSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400, { ok: false, message: "text (at most 1,900 characters) and language are required." });
    if (!(await canSpeak(learner.userId, parsed.data.text.length))) return send(response, 429, { ok: false, reason: "voice-limit", message: "You've used today's reading aloud." });
    // The listener stopping (or leaving) closes this response, which stops Deepgram too.
    const listener = new AbortController();
    response.on("close", () => listener.abort());
    const { audio, requestId } = await speakStream(parsed.data.text, parsed.data.language, listener.signal);
    await recordSpeak(learner.userId, parsed.data.text.length, "tutor-voice", requestId);
    // X-Accel-Buffering: nginx in front of the lab passes the audio on as it comes instead of collecting it.
    response.writeHead(200, { "Content-Type": `audio/pcm;rate=${SPEAK_SAMPLE_RATE}`, "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    await pipeline(Readable.fromWeb(audio as NodeReadableStream<Uint8Array>), response).catch(() => {
      // Stopped by the listener, or Deepgram's stream broke off: what was sent was played.
    });
    return;
  }
  return send(response, 404, { ok: false, message: "Not found." });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: Error & { status?: number }) => {
    const status = error.status ?? 500;
    if (status >= 500) logAi("error", { event: "learning.error", path: request.url, error: String(error.stack ?? error).slice(0, 1000) });
    if (!response.headersSent) send(response, status, { ok: false, message: status >= 500 ? "The tutor had a problem. Try again." : error.message });
  });
});

server.listen(PORT, () => logAi("info", { event: "learning.start", port: PORT, hub: HUB_API_URL }));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    prisma.$disconnect().finally(() => process.exit(0));
  });
}
