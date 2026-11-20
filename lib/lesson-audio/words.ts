// A lesson audio's transcript as words (docs/lesson-audio.md, "Following the audio"). Shared by the worker, which
// works out when each word is said (lib/lesson-audio/timing.ts), and the learner's player, which highlights the word
// being said: both must cut the script into the same words, so both use these. No server imports: it runs in browsers.

/** Word timings as stored on LessonAudio.timings. */
export type WordTimings = {
  v: 1;
  /** The share of the script's words heard in the audio (the rest were placed between them). */
  matched: number;
  /** When each word of the script starts, in hundredths of a second, in script order. */
  words: number[];
};

export type TranscriptParagraph = { words: string[]; first: number };

/** The script's paragraphs (a blank line apart), each with its words and the index of its first word in the script. */
export function transcriptParagraphs(script: string): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];
  let first = 0;
  for (const block of script.split(/\n\s*\n/)) {
    const words = block.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    paragraphs.push({ words, first });
    first += words.length;
  }
  return paragraphs;
}

/** Every word of the script, in order: the same words transcriptParagraphs gives, one list. */
export function transcriptWords(script: string): string[] {
  return script.split(/\s+/).filter(Boolean);
}

/** A word as compared with what was heard: lower case, no accents, letters and digits only. */
export function comparable(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * When each word starts if the voice kept an even pace: by its place in the script's characters. What the player uses
 * until the real timings are worked out, and what timing falls back on between words it heard.
 */
export function estimatedStarts(words: string[], seconds: number): number[] {
  const total = words.reduce((sum, word) => sum + word.length + 1, 0) || 1;
  const starts: number[] = [];
  let at = 0;
  for (const word of words) {
    starts.push(Math.round((at / total) * seconds * 100));
    at += word.length + 1;
  }
  return starts;
}

/** The word being said at `seconds`: the last one started by then (-1 before the first). */
export function wordAt(starts: number[], seconds: number): number {
  const target = seconds * 100;
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] <= target) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Stored timings, if they fit this script (the same number of words); else null. */
export function readTimings(value: unknown, wordCount: number): number[] | null {
  const timings = value as Partial<WordTimings> | null;
  if (!timings || timings.v !== 1 || !Array.isArray(timings.words) || timings.words.length !== wordCount) return null;
  return timings.words;
}
