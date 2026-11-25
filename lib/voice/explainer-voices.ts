// The voices the AI explainers can speak in (docs/voice.md, "The explainer's voice"), chosen by ear in Admin → Audio:
// Deepgram Flux TTS voices (paid), and Pocket TTS voices that run on the lab server (free, "The free voice"). In its
// own file, with nothing from the server in it, so the admin page can list them too.

export type VoiceEngine = "flux" | "pocket";
export type ExplainerVoice = { id: string; name: string; about: string; engine: VoiceEngine };

/** English voices an admin can choose from (developers.deepgram.com/docs/flux-tts/voices, 2026-11-20). */
export const EXPLAINER_VOICES: readonly ExplainerVoice[] = [
  { id: "flux-hannah-en", name: "Hannah", about: "American, young woman: clear, confident, thoughtful", engine: "flux" },
  { id: "flux-elise-en", name: "Elise", about: "American woman: clear, professional, calm", engine: "flux" },
  { id: "flux-marcus-en", name: "Marcus", about: "American man: friendly, smooth, professional", engine: "flux" },
  { id: "flux-bruce-en", name: "Bruce", about: "American man: friendly, natural, engaged", engine: "flux" },
  // Pocket TTS's built-in English voices (github.com/kyutai-labs/pocket-tts, the README's catalogue), a few of them.
  // The id after "pocket-" is the name its server takes.
  { id: "pocket-alba", name: "Alba", about: "Pocket TTS's default English voice", engine: "pocket" },
  { id: "pocket-anna", name: "Anna", about: "Pocket TTS English voice", engine: "pocket" },
  { id: "pocket-mary", name: "Mary", about: "Pocket TTS English voice", engine: "pocket" },
  { id: "pocket-eve", name: "Eve", about: "Pocket TTS English voice", engine: "pocket" },
  { id: "pocket-charles", name: "Charles", about: "Pocket TTS English voice", engine: "pocket" },
  { id: "pocket-michael", name: "Michael", about: "Pocket TTS English voice", engine: "pocket" },
];

export const DEFAULT_EXPLAINER_VOICE = "flux-hannah-en";
/** Spanish replies, read by the Spanish voice of the chosen engine: the English voices above only speak English. */
export const SPANISH_EXPLAINER_VOICE = "flux-valentina-es";
export const SPANISH_POCKET_VOICE = "pocket-lola";
/** The Pocket voice used when Deepgram fails and the chosen voice is a Flux one. */
export const DEFAULT_POCKET_VOICE = "pocket-alba";

export const isExplainerVoice = (id: unknown): id is string => typeof id === "string" && EXPLAINER_VOICES.some((voice) => voice.id === id);
export const engineOf = (id: string): VoiceEngine => (id.startsWith("pocket-") ? "pocket" : "flux");
/** The name Pocket TTS's server takes for a voice: "pocket-alba" is "alba". */
export const pocketName = (id: string) => id.replace(/^pocket-/, "");
