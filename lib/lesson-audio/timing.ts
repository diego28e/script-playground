import { LIST_PRICES, WORKLOADS, recordCharge } from "@/lib/spend/charges";
import { workerSignature } from "@/lib/lesson-audio/voice";
import { comparable, transcriptWords, type WordTimings } from "@/lib/lesson-audio/words";

// When each word of a lesson's audio is said (docs/lesson-audio.md, "Following the audio"), so the learner's transcript
// highlights the word being said and scrolls with it. Neither voice says when it said what, so the worker has Deepgram
// listen to the finished MP3 (Nova-3, word timestamps, about US$0.07 for a 15-minute lesson) and lines what it heard up
// with the script: a word heard where the script has it takes the time it was heard; the words between (a number said
// in words, a term heard as two words) are spread over the time between, by their length.

/** Below this share of the script heard, the timings would mislead more than help: the player keeps its estimate. */
const MIN_MATCHED = 0.5;
/** How far ahead in what was heard a script word is looked for. */
const LOOK_AHEAD = 40;

export type HeardWord = { word: string; start: number; end: number };

/**
 * The script's words against what was heard. A heard word matches the script's when they're the same word; a short
 * one (under five letters: "de", "the") only when it comes right after the last match, or the next script word follows
 * it too, so a common word far ahead doesn't pull the line forward.
 */
export function alignWords(script: string[], heard: HeardWord[], seconds: number): WordTimings {
  const said = script.map(comparable);
  const heardWords = heard.map((word) => comparable(word.word));
  const starts: (number | null)[] = said.map(() => null);
  const nextSaid = (from: number) => {
    for (let i = from; i < said.length; i++) if (said[i]) return said[i];
    return null;
  };

  let next = 0;
  let matched = 0;
  let counted = 0;
  for (let i = 0; i < said.length; i++) {
    if (!said[i]) continue;
    counted++;
    const end = Math.min(heardWords.length, next + LOOK_AHEAD);
    for (let k = next; k < end; k++) {
      if (heardWords[k] !== said[i]) continue;
      const following = nextSaid(i + 1);
      // In step: the word right after the last one heard, with the script's word before it matched too.
      const inStep = k === next && i > 0 && starts[i - 1] !== null;
      const confirmed = inStep || said[i].length >= 5 || following === null || heardWords.slice(k + 1, k + 4).includes(following);
      if (!confirmed) continue;
      starts[i] = Math.round(heard[k].start * 100);
      next = k + 1;
      matched++;
      break;
    }
  }

  // The words between two heard ones share the time between them, by their length; before the first heard word, from
  // the start; after the last, to the end of the speech.
  const lastHeard = heard.at(-1)?.end ?? seconds;
  const filled: number[] = new Array(said.length);
  let i = 0;
  while (i < said.length) {
    if (starts[i] !== null) {
      filled[i] = starts[i]!;
      i++;
      continue;
    }
    let j = i;
    while (j < said.length && starts[j] === null) j++;
    // The heard word before the run takes its share of the time too.
    const from = i > 0 ? filled[i - 1] : 0;
    const to = j < said.length ? starts[j]! : Math.round(lastHeard * 100);
    const run = script.slice(i > 0 ? i - 1 : i, j);
    const weights = run.map((word) => word.length + 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const span = Math.max(0, to - from);
    let before = i > 0 ? weights[0] : 0;
    for (let k = i; k < j; k++) {
      filled[k] = from + Math.round((before / total) * span);
      before += weights[k - i + (i > 0 ? 1 : 0)];
    }
    i = j;
  }
  for (let k = 1; k < filled.length; k++) if (filled[k] < filled[k - 1]) filled[k] = filled[k - 1];
  return { v: 1, matched: counted ? Math.round((matched / counted) * 1000) / 1000 : 0, words: filled };
}

/** An address Deepgram can fetch the audio from, from the platform (the worker holds no media keys). */
async function audioAddress(audioId: string): Promise<{ url: string; local: boolean }> {
  const platform = process.env.PLATFORM_URL?.replace(/\/+$/, "");
  const secret = process.env.LAB_WORKER_SECRET;
  if (!platform || !secret) throw new Error("PLATFORM_URL and LAB_WORKER_SECRET must be set on the worker.");
  const body = JSON.stringify({ audioId });
  const time = String(Date.now());
  const response = await fetch(`${platform}/api/lab-worker/audio-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-worker-time": time, "x-worker-signature": workerSignature(secret, time, body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !answer?.url) throw new Error(`The platform didn't give the audio's address (${response.status}${answer?.error ? `: ${answer.error}` : ""}).`);
  // On a PC the media are the platform's own files (lib/media.ts): Deepgram can't reach them, so they're sent instead.
  return answer.url.startsWith("/") ? { url: `${platform}${answer.url}`, local: true } : { url: answer.url, local: false };
}

/** Works out the timings of a voiced lesson. Throws when it can't (the caller counts the try). */
export async function timeLessonAudio(row: { id: string; lessonId: string; audioScript: string; audioSeconds: number | null; requestedById: string }, language: string, courseId: string | null): Promise<WordTimings> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set on the worker.");
  const { url, local } = await audioAddress(row.id);
  const params = new URLSearchParams({ model: "nova-3", language: language === "es" ? "es" : "en", tag: WORKLOADS["lesson-audio.timing"].tag });
  let body: BodyInit = JSON.stringify({ url });
  let type = "application/json";
  if (local) {
    const file = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!file.ok) throw new Error(`The audio couldn't be read from the platform (${file.status}).`);
    body = await file.arrayBuffer();
    type = "audio/mpeg";
  }
  const charge = { provider: "deepgram" as const, workload: "lesson-audio.timing" as const, model: "nova-3", runtime: "worker" as const, userId: row.requestedById, courseId, lessonId: row.lessonId, audioId: row.id };
  let response: Response;
  try {
    response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": type },
      body,
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    // Cut off: Deepgram may still have listened, and billed it.
    await recordCharge({ ...charge, ok: false, detail: { error: String(error).slice(0, 200) } });
    throw error;
  }
  const result = (await response.json().catch(() => null)) as {
    results?: { channels?: { alternatives?: { words?: HeardWord[] }[] }[] };
    metadata?: { request_id?: string; duration?: number };
    err_msg?: string;
  } | null;
  const seconds = result?.metadata?.duration ?? row.audioSeconds ?? null;
  await recordCharge({
    ...charge,
    ok: response.ok,
    requestId: result?.metadata?.request_id ?? response.headers.get("dg-request-id"),
    audioSeconds: seconds,
    estimatedUsd: seconds ? (seconds / 60) * LIST_PRICES.deepgramNovaMonoPerMinute : 0,
    detail: response.ok ? { sent: local ? "file" : "url" } : { status: response.status },
  });
  if (!response.ok) throw new Error(`Deepgram couldn't listen to the audio (${response.status}${result?.err_msg ? `: ${result.err_msg}` : ""})`);
  const heard = result?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  if (!heard.length) throw new Error("Deepgram heard no speech in the audio.");
  const timings = alignWords(transcriptWords(row.audioScript), heard, seconds ?? heard.at(-1)!.end);
  if (timings.matched < MIN_MATCHED) throw new Error(`Only ${Math.round(timings.matched * 100)}% of the script was heard in the audio: it may not be this script's audio.`);
  return timings;
}
