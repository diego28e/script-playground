import { logAi } from "@/lib/ai/gemini";
import { SPEAK_SAMPLE_RATE, type VoiceLanguage } from "@/lib/voice/deepgram";

// The self-hosted voice (docs/voice.md, "The free voice"): Kyutai's Pocket TTS, a small text-to-speech model that runs
// on the lab server's CPU, one container per language (infra/lab/pocket-tts). Free and private: nothing leaves the
// server. The learning service reaches it on the lab's private voice network; nothing else can.
//
// Measured on the lab server (2 cores, normal mode), 2026-11-25: 1.66 to 1.70 times faster than real time, each
// request starting in 100 to 150 ms. It has no speed setting: it reads at its own pace, faster than Flux at 0.9×.
// Its server streams a WAV file as it's made; this passes on the raw PCM inside it, the format the browser's Speaker
// plays (24 kHz, 16-bit, mono), and refuses anything else rather than play it at the wrong speed.

/** Where each language's container answers, set on the learning service (infra/lab/compose.yaml); unset: not here. */
const URLS: Record<VoiceLanguage, string | undefined> = {
  en: process.env.POCKET_TTS_EN_URL,
  es: process.env.POCKET_TTS_ES_URL,
};

export function pocketConfigured(language: VoiceLanguage): boolean {
  return Boolean(URLS[language]);
}

/** A WAV stream's format, and where its audio starts, once enough of it has arrived; null until then. */
function readWavHeader(bytes: Uint8Array): { rate: number; bits: number; channels: number; dataAt: number } | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Pocket TTS didn't answer with a WAV file");
  let at = 12;
  let format: { rate: number; bits: number; channels: number } | null = null;
  // Chunks: "fmt " says the format, "data" starts the audio; anything else is skipped.
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      if (at + 8 + 16 > bytes.length) return null;
      format = { channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
    } else if (id === "data") {
      if (!format) throw new Error("Pocket TTS's WAV has no format before its audio");
      return { ...format, dataAt: at + 8 };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Reads `text` aloud with Pocket TTS in one of its built-in voices: raw 16-bit PCM at SPEAK_SAMPLE_RATE, streamed as
 * it's made. Throws when the container isn't set up, doesn't answer within 10 s, or answers in another format.
 * `signal` stops it (the container stops generating when the request closes).
 */
export async function speakPocket(text: string, language: VoiceLanguage, voice: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const base = URLS[language]?.replace(/\/+$/, "");
  if (!base) throw new Error(`Pocket TTS isn't set up for ${language}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const started = Date.now();
  const form = new FormData();
  form.set("text", text);
  form.set("voice_url", voice);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  let head = new Uint8Array(0);
  let header: ReturnType<typeof readWavHeader> = null;
  try {
    const response = await fetch(`${base}/tts`, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Pocket TTS answered ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
    reader = response.body.getReader();
    // The header first: what follows it is the audio.
    while (!header) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Pocket TTS ended before any audio");
      const joined = new Uint8Array(head.length + value.length);
      joined.set(head);
      joined.set(value, head.length);
      head = joined;
      header = readWavHeader(head);
    }
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
  clearTimeout(timer);
  if (header.rate !== SPEAK_SAMPLE_RATE || header.bits !== 16 || header.channels !== 1) {
    void reader.cancel();
    throw new Error(`Pocket TTS sent ${header.rate} Hz, ${header.bits}-bit, ${header.channels} channels; the player needs ${SPEAK_SAMPLE_RATE} Hz, 16-bit mono`);
  }
  logAi("info", { event: "voice.pocket", language, voice, characters: text.length, firstMs: Date.now() - started });
  const first = head.subarray(header.dataAt);
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(stream) {
      if (!sentFirst) {
        sentFirst = true;
        if (first.length) return stream.enqueue(first);
      }
      const { done, value } = await reader.read();
      if (done) stream.close();
      else stream.enqueue(value);
    },
    cancel(reason) {
      controller.abort();
      return reader.cancel(reason);
    },
  });
}
