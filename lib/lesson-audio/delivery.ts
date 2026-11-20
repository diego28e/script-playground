import { generateWithFallback } from "@/lib/ai/gemini";
import { narrationChain } from "@/lib/lesson-audio/script";

// Delivery (docs/lesson-audio.md): before an expressive voice reads an approved script, a model directs the
// performance, the way ElevenLabs' own "Enhance" button does (its prompt, in "Prompting Eleven v4" of
// elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices, 2026-11-19), tuned for a teacher. It adds
// audio tags in square brackets for tone and pauses, and emphasis through punctuation and capitals, and never changes a
// word. That last rule is checked, not trusted: a piece whose words changed is voiced as the admin approved it.
//
// Tried on lesson 00.04's script (2026-11-19, Qwen4-Max): two pieces of about 3,000 characters came back in 11 s each,
// every word kept, with 10 and 13 tags (one every two or three sentences) adding about 5% to the characters voiced.
//
// What the docs say about Eleven v4, which shapes the rules below:
//   - no SSML: `<break time="1s"/>` isn't supported; pauses come from tags ([short pause]) and ellipses;
//   - tags that clearly describe the voice ("[warm, encouraging tone]") work better than ones that could be read as a
//     sound effect, and tags land best when they suit the voice;
//   - ellipses add pauses and weight, capitals add emphasis, punctuation sets the rhythm;
//   - too many directions make the delivery unstable, so they are used sparingly.
//
// Whispers (2026-11-20): every lesson dropped into a hushed voice for a few seconds, several times. The prompt already
// said never to whisper, but it offered soft tags, and v4 follows a tag's sense closely. Measured on the audio (level
// and voicing of the seconds after each tag, against untagged sentence starts; docs/lesson-audio.md has the numbers):
//   - in a voiced lesson (00.04), 3 of 6 [gently] were hushed, against 2 of 141 sentences with no tag; the lesson's
//     two softest passages both followed [gently];
//   - the same three passages voiced again with only the tag changed: [gently] was 2.5 to 5.6 dB under the sentence
//     before it every time, once a true whisper (3 s at 8.5 dB under, voicing 0.14 where speech has 0.65); with no tone
//     tag, [reassuring], [matter-of-fact] or [confident] the voice stayed full; [serious] lowered it (2 to 4 dB,
//     voicing about 0.43), a grave voice rather than a whisper;
//   - one test sentence each: [thoughtful] and [exhales] softened their first second.
// So a tag is kept only if it's on DELIVERY_TAGS, tags measured to keep a full, normal speaking voice. Anything else the
// model writes is taken out before voicing (the words stay as approved either way). Warnings and "here's the catch"
// lines, where a model reaches for a gentle or serious tag, are directed [matter-of-fact] or [confident].

export const DELIVERY_PROMPT = `You direct the delivery of an educational audio lesson that a text-to-speech voice (ElevenLabs Eleven v4) will read. A teacher recorded the script; you mark how it should be SPOKEN so it sounds like a good teacher talking to one learner: warm, clear, patient, engaged, never theatrical.

YOU MAY ONLY ADD:
1. Audio tags in square brackets, placed right before the words they shape (or right after, for a reaction such as [soft chuckle]).
2. Emphasis without changing words: CAPITALS on the one key word of a paragraph at most (never two in a paragraph: it sounds like shouting), an ellipsis (...) for a thoughtful pause, a question mark or exclamation point where the sentence already is one in spirit.

NEVER change, add, remove or reorder a word of the text. Never put the text's own words inside brackets. Keep every paragraph break.

THE ONLY TAGS YOU MAY USE (exactly as written; any other tag is removed before the voice reads the text). They all keep the teacher's full, normal speaking voice:
- Tone: [warmly], [warm, encouraging tone], [reassuring], [curious], [enthusiastic], [lightly amused], [matter-of-fact], [confident], [conversational tone].
- Pace: [slower, deliberate], [measured pace], [brisk], [picking up energy].
- Pauses: [short pause], [pause], [long pause].

WHERE THEY HELP A LEARNER:
- The opening line of the lesson: one welcoming tone tag.
- A key idea or a definition: [slower, deliberate] or [measured pace], and CAPITALS on its one key word.
- A turn ("Now", "Here's the catch", "So far"): a [short pause] before it, often with a tone tag.
- A question to the learner, or "Pause here and try": the question, then [long pause] before the answer starts.
- A common mistake, a warning, or a "here's the catch" line: [matter-of-fact] or [confident]. These lines must sound firm and clear, at full voice: never confidential, lowered or grave.
- An analogy or a light aside: [lightly amused] or [warmly].
- Encouragement and recaps: [warm, encouraging tone].
- The closing: [warmly].

HOW MUCH: about one tag every two or three sentences, never more than two tags in a row, never the same tag twice in a row. Leave plain passages plain: a voice directed in every sentence sounds unstable and fake.

NEVER make the voice softer, lower or quieter than normal speech: no whispering, hushed, soft, gentle, quiet, breathy, intimate, serious, grave or thoughtful delivery, no sighs, breaths, exhales or hums. Never shouting, crying, singing, accents, sound effects ([applause], [music], any sound that isn't the voice), or anything sarcastic, mocking or dramatic. No SSML or XML of any kind.

Answer with the directed text only: no preamble, no notes, no code fences.`;

/** The tags a directed piece may keep: each keeps a full, normal speaking voice (above, "Whispers"). */
export const DELIVERY_TAGS = new Set([
  "warmly",
  "warm, encouraging tone",
  "reassuring",
  "curious",
  "enthusiastic",
  "lightly amused",
  "matter-of-fact",
  "confident",
  "conversational tone",
  "slower, deliberate",
  "measured pace",
  "brisk",
  "picking up energy",
  "short pause",
  "pause",
  "long pause",
]);

const TAG = /\[([^\]\n]{1,80})\]/g;

/** Takes out every tag that isn't on DELIVERY_TAGS (compared without case or extra spaces), and says which were taken out. */
export function keepDeliveryTags(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = text.replace(TAG, (tag, inside: string) => {
    if (DELIVERY_TAGS.has(inside.trim().toLowerCase().replace(/\s+/g, " "))) return tag;
    removed.push(tag);
    return " ";
  });
  // Where a tag was taken out, the spaces around it close up (never across a line break).
  return { text: removed.length ? kept.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.;:!?])/g, "$1").replace(/^[ \t]+|[ \t]+$/gm, "") : text, removed };
}

/** Words only, in order: tags, punctuation, capitals and spacing taken out. What must match the approved script. */
export function spokenWords(text: string): string[] {
  return text
    .replace(/\[[^\]\n]{1,80}\]/g, " ")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export type DirectedPiece = { text: string; directed: boolean; tags: number; removedTags?: string[] };

/**
 * Directs one piece of the script. Returns the directed text when its words are exactly the piece's, the piece as it
 * was otherwise (or when no model answered): delivery is a bonus, never a reason to fail the voicing.
 */
export async function directPiece(piece: string, options: { language: string; userId: string; model?: string; previous?: string }): Promise<DirectedPiece> {
  const result = await generateWithFallback({
    feature: "narrate",
    pool: "AUTHORING",
    userId: options.userId,
    models: narrationChain(options.model),
    chosenFirst: true,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              `LANGUAGE: ${options.language === "es" ? "Spanish (tags in English, as the model expects)" : "English"}`,
              options.previous ? `HOW THE PREVIOUS PIECE ENDED (for continuity; don't repeat it):\n"""\n${options.previous}\n"""` : "",
              `THE PIECE TO DIRECT:\n"""\n${piece}\n"""`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
    ],
    config: { systemInstruction: DELIVERY_PROMPT, maxOutputTokens: 4_000, temperature: 0.5 },
  });
  if (!result.ok) return { text: piece, directed: false, tags: 0 };
  const text = result.text
    .trim()
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .replace(/^"""\n?|\n?"""$/g, "")
    // SSML, which v4 doesn't take, if a model adds some anyway.
    .replace(/<[^>\n]{1,80}>/g, "")
    .trim();
  const same = spokenWords(text).join(" ") === spokenWords(piece).join(" ");
  if (!same) return { text: piece, directed: false, tags: 0 };
  const { text: kept, removed } = keepDeliveryTags(text);
  if (removed.length) console.info(JSON.stringify({ event: "lesson_audio.delivery_tags_removed", removed: removed.slice(0, 10) }));
  return { text: kept, directed: true, tags: (kept.match(TAG) ?? []).length, ...(removed.length ? { removedTags: removed } : {}) };
}
