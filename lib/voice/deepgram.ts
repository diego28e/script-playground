// Deepgram, the platform's voice provider (docs/voice.md). Everything provider-specific about speech is in this file:
// switching providers means another file with these exports, and the panels and pages don't change.
//
// The API key stays on the servers. A browser gets a ListenGrant: the full streaming address, and WebSocket
// subprotocols carrying a temporary token (30 seconds; the stream stays open after it expires).

const API = "https://api.deepgram.com";
const STREAM = "wss://api.deepgram.com";

export type VoiceLanguage = "es" | "en";
/** conversation: Flux, which ends a turn when the speaker finishes; dictation: Nova-3, stopped by hand. */
export type ListenMode = "conversation" | "dictation";

export type ListenGrant = {
  /** How the browser reads the stream's messages: Flux's TurnInfo, or Nova's Results. */
  protocol: "flux" | "nova";
  url: string;
  protocols: string[];
  /** The audio the browser sends: 16 kHz mono, 16-bit little-endian PCM. */
  encoding: "linear16";
  sampleRate: 16000;
  expiresIn: number;
};

/** The course's words a general model mishears, given as key terms on every stream ("Landgraf" for LangGraph). */
export const VOICE_KEYTERMS = [
  "LangChain",
  "LangGraph",
  "LangSmith",
  "Jupyter",
  "notebook",
  "kernel",
  "agente",
  "prompt",
  "embeddings",
  "tool",
  "retrieval",
  "vector store",
  "base de datos",
  "Groq",
  "DeepSeek",
  "Gemini",
  "Python",
  "LLM",
];

/** Aura-2 voices: Latin American Spanish that switches to English for terms, and American English. */
const VOICES: Record<VoiceLanguage, string> = { es: "aura-2-selena-es", en: "aura-2-thalia-en" };
/** Aura-2 takes at most 2,000 characters a request. */
export const SPEAK_MAX_CHARS = 1900;

/** List prices in millionths of a dollar (deepgram.com/pricing, 2026-11-06), for ai_request's cost column. */
export const VOICE_PRICES = { fluxPerMinute: 7_800, novaMultiPerMinute: 9_200, keytermsPerMinute: 1_300, speakPer1000Chars: 30_000 };
export const VOICE_MODELS = { conversation: "deepgram-flux-multi", dictation: "deepgram-nova-3-multi", speak: "deepgram-aura-2" } as const;

export function voiceConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

function key(): string {
  const value = process.env.DEEPGRAM_API_KEY;
  if (!value) throw new Error("DEEPGRAM_API_KEY is not set");
  return value;
}

/** A temporary token (JWT, 30 s) for the browser's own stream. */
async function grantToken(): Promise<{ token: string; expiresIn: number }> {
  const response = await fetch(`${API}/v1/auth/grant`, { method: "POST", headers: { Authorization: `Token ${key()}` }, signal: AbortSignal.timeout(8000) });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; err_msg?: string };
  if (!response.ok || !body.access_token) throw new Error(`Deepgram refused a token (${response.status}${body.err_msg ? `: ${body.err_msg}` : ""})`);
  return { token: body.access_token, expiresIn: body.expires_in ?? 30 };
}

/** Everything a browser needs to stream the microphone for `mode`. */
export async function listenGrant(mode: ListenMode, language: VoiceLanguage): Promise<ListenGrant> {
  const { token, expiresIn } = await grantToken();
  const terms = VOICE_KEYTERMS.map((term) => `&keyterm=${encodeURIComponent(term)}`).join("");
  const url =
    mode === "conversation"
      ? // Patient turn-taking: a pause to think doesn't end the turn; 4 s of silence does. Both languages hinted, the
        // learner's first, since learners mix English terms into Spanish.
        `${STREAM}/v2/listen?model=flux-general-multi&encoding=linear16&sample_rate=16000&language_hint=${language}&language_hint=${language === "es" ? "en" : "es"}&eot_threshold=0.85&eot_timeout_ms=4000${terms}`
      : `${STREAM}/v1/listen?model=nova-3&language=multi&encoding=linear16&sample_rate=16000&interim_results=true&smart_format=true&punctuate=true${terms}`;
  return { protocol: mode === "conversation" ? "flux" : "nova", url, protocols: ["bearer", token], encoding: "linear16", sampleRate: 16000, expiresIn };
}

/** Reads `text` aloud: MP3 audio. At most SPEAK_MAX_CHARS characters (the caller splits longer text). */
export async function speak(text: string, language: VoiceLanguage): Promise<ArrayBuffer> {
  const response = await fetch(`${API}/v1/speak?model=${VOICES[language]}&encoding=mp3`, {
    method: "POST",
    headers: { Authorization: `Token ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, SPEAK_MAX_CHARS) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Deepgram couldn't speak it (${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)})`);
  return response.arrayBuffer();
}

/** What's left of the account's credit, for the admin page (needs a key that can read the project: admin or owner). */
export async function voiceBalance(): Promise<{ amount: number; units: string } | null> {
  const headers = { Authorization: `Token ${key()}` };
  const projects = (await (await fetch(`${API}/v1/projects`, { headers, signal: AbortSignal.timeout(8000) })).json().catch(() => ({}))) as { projects?: { project_id: string }[] };
  const project = projects.projects?.[0];
  if (!project) return null;
  const balances = (await (await fetch(`${API}/v1/projects/${project.project_id}/balances`, { headers, signal: AbortSignal.timeout(8000) })).json().catch(() => ({}))) as {
    balances?: { amount: number; units: string }[];
  };
  const first = balances.balances?.[0];
  return first ? { amount: first.amount, units: first.units } : null;
}
