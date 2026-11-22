// Interrupting the teacher by voice (docs/voice.md, "Interrupting by voice"): while the teacher thinks or speaks, the
// microphone keeps listening, and what it hears is weighed here. Three things must not cut the teacher off: a
// listening sound ("mm-hm", "okay"), a cough or a word or two, and the teacher's own voice coming back through the
// speakers when the browser's echo cancellation misses some of it. Pure functions, so they can be checked without a
// microphone (scripts/voice-context-check.ts).

/** Listening sounds and fillers: alone, they never interrupt. */
const FILLERS = new Set(
  [
    "mm", "mhm", "mmhm", "mm-hm", "hmm", "hm", "uh", "um", "uhm", "ah", "oh", "eh", "huh",
    "yeah", "yes", "yep", "yup", "ok", "okay", "right", "sure", "cool", "nice", "great", "got", "it", "i", "see", "aha", "alright",
    "sí", "si", "vale", "ya", "claro", "ajá", "aja", "bueno", "bien", "ok", "okey", "entiendo", "entendido", "eso",
  ].map((word) => word.normalize("NFC")),
);

/** Words that mean "stop" on their own: one is enough. */
const STOPS = new Set(["wait", "stop", "hold", "pause", "sorry", "espera", "esperá", "para", "pará", "perdón", "perdona", "momento"]);

/** The words of a text, lower case, letters and digits only. */
export function wordsOf(text: string): string[] {
  return (text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).map((word) => word.replace(/^'+|'+$/g, ""));
}

/**
 * Whether what the microphone heard is the teacher's own voice coming back: most of its three-word runs appear, in the
 * same order, in what the teacher is saying. A learner who asks about the same thing uses the same words but rarely
 * the same runs of three.
 */
export function isEcho(heard: string[], speaking: string): boolean {
  if (heard.length < 3) return false;
  const said = wordsOf(speaking);
  const runs = new Set<string>();
  for (let index = 0; index + 2 < said.length; index += 1) runs.add(`${said[index]} ${said[index + 1]} ${said[index + 2]}`);
  let found = 0;
  let total = 0;
  for (let index = 0; index + 2 < heard.length; index += 1) {
    total += 1;
    if (runs.has(`${heard[index]} ${heard[index + 1]} ${heard[index + 2]}`)) found += 1;
  }
  return total > 0 && found / total >= 0.6;
}

/** At least this many words that aren't fillers before the teacher is cut off: about a second of speech. */
export const BARGE_WORDS = 3;

/**
 * Whether what the microphone heard while the teacher thinks or speaks is the learner taking the turn: a stop word, or
 * at least BARGE_WORDS words that aren't fillers, and not the teacher's own voice.
 */
export function isInterruption(heard: string, speaking: string): boolean {
  const words = wordsOf(heard);
  if (!words.length) return false;
  if (isEcho(words, speaking)) return false;
  const meaningful = words.filter((word) => !FILLERS.has(word));
  if (meaningful.some((word) => STOPS.has(word))) return true;
  return meaningful.length >= BARGE_WORDS;
}
