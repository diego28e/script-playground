import { LIST_PRICES, WORKLOADS, recordCharge } from "@/lib/spend/charges";
import { workerSignature } from "@/lib/lesson-audio/voice";
import { comparable, TIMINGS_VERSION, transcriptWords, type WordTimings } from "@/lib/lesson-audio/words";

// When each word of a lesson's audio is said (docs/lesson-audio.md, "Following the audio"), so the learner's transcript
// highlights the word being said and scrolls with it. Neither voice says when it said what, so the worker has Deepgram
// listen to the finished MP3 (Nova-3, word timestamps, about US$0.07 for a 15-minute lesson) and lines what it heard up
// with the script (alignWords): a word heard where the script has it takes the time it was heard; the words between (a
// number said in words, a term heard as two words) are spread over the time between, by their length.

/** Below this share of the script heard, the timings would mislead more than help: the player keeps its estimate. */
const MIN_MATCHED = 0.5;
/** How far ahead in what was heard a script word is looked for, between two anchors. */
const LOOK_AHEAD = 40;
/** An anchor: this many words in a row, found once in the script and once in what was heard. */
const ANCHOR_WORDS = 4;

export type HeardWord = { word: string; start: number; end: number };

/** The positions of the longest run of pairs whose heard positions keep rising (patience sorting). */
function increasing(pairs: [number, number][]): [number, number][] {
  const tails: number[] = [];
  const previous: number[] = new Array(pairs.length).fill(-1);
  for (let index = 0; index < pairs.length; index++) {
    const value = pairs[index][1];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pairs[tails[middle]][1] < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }
  const chain: [number, number][] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) chain.push(pairs[index]);
  return chain.reverse();
}

/**
 * The script's words against what was heard, in two passes, so a stretch where they differ (a passage misheard, a
 * number said in words, terms in another language) can't throw the rest of the lesson off:
 *
 * 1. Anchors: every run of four words that occurs exactly once in the script and once in what was heard, kept only
 *    in an order both agree on. They pin the line every few sentences.
 * 2. Between two anchors, word by word: a heard word matches the script's when they're the same word; a short one
 *    (under five letters: "de", "the") only right after the last match, or when the next script word follows it, so
 *    a common word further on doesn't pull the line forward.
 */
export function alignWords(script: string[], heard: HeardWord[], seconds: number): WordTimings {
  const said = script.map(comparable);
  const heardWords = heard.map((word) => comparable(word.word));
  const starts: (number | null)[] = said.map(() => null);
  const take = (i: number, k: number) => {
    starts[i] = Math.round(heard[k].start * 100);
  };

  // Words that count (not punctuation alone), by position.
  const saidAt = said.flatMap((word, i) => (word ? [i] : []));
  const heardAt = heardWords.flatMap((word, k) => (word ? [k] : []));
  const runs = (words: string[], at: number[]) => {
    const found = new Map<string, number>();
    for (let n = 0; n + ANCHOR_WORDS <= at.length; n++) {
      const key = at
        .slice(n, n + ANCHOR_WORDS)
        .map((position) => words[position])
        .join(" ");
      found.set(key, found.has(key) ? -1 : n);
    }
    return found;
  };
  const saidRuns = runs(said, saidAt);
  const heardRuns = runs(heardWords, heardAt);
  const pairs: [number, number][] = [];
  for (const [key, n] of saidRuns) {
    const m = heardRuns.get(key);
    if (n >= 0 && m !== undefined && m >= 0) pairs.push([n, m]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  // Anchors in an order both agree on, and not overlapping: a later one starts after the earlier one ends.
  const anchors: [number, number][] = [];
  for (const [n, m] of increasing(pairs)) {
    const last = anchors.at(-1);
    if (last && (n < last[0] + ANCHOR_WORDS || m < last[1] + ANCHOR_WORDS)) continue;
    anchors.push([n, m]);
  }
  for (const [n, m] of anchors) for (let j = 0; j < ANCHOR_WORDS; j++) take(saidAt[n + j], heardAt[m + j]);

  // Between anchors (and before the first, after the last), word by word, never past the next anchor.
  const bounds: [number, number, number, number][] = [];
  let fromSaid = 0;
  let fromHeard = 0;
  for (const [n, m] of anchors) {
    bounds.push([fromSaid, saidAt[n], fromHeard, heardAt[m]]);
    fromSaid = saidAt[n + ANCHOR_WORDS - 1] + 1;
    fromHeard = heardAt[m + ANCHOR_WORDS - 1] + 1;
  }
  bounds.push([fromSaid, said.length, fromHeard, heardWords.length]);
  for (const [saidFrom, saidTo, heardFrom, heardTo] of bounds) {
    const nextSaid = (from: number) => {
      for (let i = from; i < saidTo; i++) if (said[i]) return said[i];
      return null;
    };
    let next = heardFrom;
    for (let i = saidFrom; i < saidTo; i++) {
      if (!said[i]) continue;
      const end = Math.min(heardTo, next + LOOK_AHEAD);
      for (let k = next; k < end; k++) {
        if (heardWords[k] !== said[i]) continue;
        const following = nextSaid(i + 1);
        // In step: the word right after the last one heard, with the script's word before it matched too.
        const inStep = k === next && i > 0 && starts[i - 1] !== null;
        const confirmed = inStep || said[i].length >= 5 || following === null || heardWords.slice(k + 1, k + 4).includes(following);
        if (!confirmed) continue;
        take(i, k);
        next = k + 1;
        break;
      }
    }
  }
  const counted = saidAt.length;
  const matched = saidAt.filter((i) => starts[i] !== null).length;

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
  return { v: TIMINGS_VERSION, matched: counted ? Math.round((matched / counted) * 1000) / 1000 : 0, words: filled };
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
  if (timings.matched < MIN_MATCHED) {
    throw Object.assign(new Error(`Only ${Math.round(timings.matched * 100)}% of the script was heard in the audio: it may not be this script's audio.`), { final: true });
  }
  return timings;
}
