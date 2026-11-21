// The voices the AI explainers can speak in (docs/voice.md, "The explainer's voice"): Deepgram Flux TTS voices, chosen
// by ear. In its own file, with nothing from the server in it, so the admin page can list them too.

export type ExplainerVoice = { id: string; name: string; about: string };

/** English voices an admin can choose from in Admin → Audio (developers.deepgram.com/docs/flux-tts/voices, 2026-11-20). */
export const EXPLAINER_VOICES: readonly ExplainerVoice[] = [
  { id: "flux-hannah-en", name: "Hannah", about: "American, young woman: clear, confident, thoughtful" },
  { id: "flux-elise-en", name: "Elise", about: "American woman: clear, professional, calm" },
  { id: "flux-marcus-en", name: "Marcus", about: "American man: friendly, smooth, professional" },
  { id: "flux-bruce-en", name: "Bruce", about: "American man: friendly, natural, engaged" },
];

export const DEFAULT_EXPLAINER_VOICE = "flux-hannah-en";
/** Replies in Spanish are read by this Flux voice: the ones above only speak English. */
export const SPANISH_EXPLAINER_VOICE = "flux-valentina-es";

export const isExplainerVoice = (id: unknown): id is string => typeof id === "string" && EXPLAINER_VOICES.some((voice) => voice.id === id);
