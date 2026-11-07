// The tutor's reply while the model is still writing it (docs/voice.md, "Streaming the tutor"). The model answers with
// one JSON object, {"actions": [...], "reply": "..."} (lib/tutor/tools.ts), so the reply is the last string in a JSON
// document that is still arriving: these read it as far as it has come.

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/**
 * The "reply" string of a partial JSON answer, decoded as far as it has arrived, or null before its key has. An
 * escape cut in half at the end waits for the rest. `done` once its closing quote has arrived.
 */
export function partialReply(raw: string): { text: string; done: boolean } | null {
  // An answer in prose rather than JSON (it happens: DeepSeek's retry without JSON mode) is the reply itself, as
  // readResponse shows it. A fenced ```json answer is still JSON.
  const start = raw.trimStart();
  if (start && !start.startsWith("{") && !start.startsWith("`")) return { text: start, done: false };
  const key = /"reply"\s*:\s*"/.exec(raw);
  if (!key) return null;
  let text = "";
  for (let i = key.index + key[0].length; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') return { text, done: true };
    if (char !== "\\") {
      text += char;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      text += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    text += ESCAPES[next] ?? next;
    i++;
  }
  return { text, done: false };
}

export type ReplyEvent = { type: "delta"; text: string } | { type: "reset" };

/**
 * Turns the model's growing answer into reply events: each new piece of the reply as a delta, and a reset when the
 * chain moves to another model after the first had started (what was shown is dropped; the next model starts over).
 */
export function replyStreamer(emit: (event: ReplyEvent) => void): (raw: string, attempt: number) => void {
  let attemptShown = -1;
  let shown = "";
  return (raw, attempt) => {
    const reply = partialReply(raw)?.text ?? "";
    // Another model, or the same one asked again: what was shown no longer leads the reply.
    if (attempt !== attemptShown || !reply.startsWith(shown)) {
      if (shown) emit({ type: "reset" });
      attemptShown = attempt;
      shown = "";
    }
    if (reply.length <= shown.length) return;
    emit({ type: "delta", text: reply.slice(shown.length) });
    shown = reply;
  };
}
