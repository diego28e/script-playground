// How fast a voice reads a reply aloud, 1 being the voice's own pace (docs/voice.md, "Speed"). In its own file so the
// browser's voice sheet and the servers that speak agree on the choices.

/**
 * Explanations are read a little slower than conversation, so they can be followed: Deepgram's own guide puts "clear
 * explanations, training content" at 0.9 (developers.deepgram.com/docs/tts-voice-controls, 2026-11-20). Chosen by ear
 * on 2026-11-20 with the Flux voices, after 0.8 dragged on Aura-2. Both engines take steps of 0.05.
 */
export const DEFAULT_SPEAK_SPEED = 0.9;
/** What a learner may choose on the voice sheet (components/voice/voice-tutor.tsx). */
export const SPEAK_SPEEDS = [0.8, 0.85, 0.9, 1] as const;
