// Hands-on stops (docs/lesson-stops.md): moments in a lesson's audio or video where the learner has a step to do on
// their own computer, so the player pauses there and shows it. What the browser needs is here, with nothing from the
// server: the stop as the players and the admin page get it, and the learner's on/off switch.

export type PlayerStop = {
  id: string;
  /** Seconds into the recording. */
  at: number;
  titleEs: string;
  titleEn: string;
  stepEs: string;
  stepEn: string;
  commands: string[];
};

/** Which recording a stop belongs to: the lesson's audio, or one of its videos. */
export const AUDIO_MEDIA = "audio";
export const videoMedia = (partId: string) => `video:${partId}`;

/**
 * The stop the playhead just reached: crossed between the last time update and this one, while playing normally (a
 * jump of more than a few seconds is a seek, and a seek past a stop doesn't stop there).
 */
export function stopCrossed(stops: PlayerStop[], before: number, now: number, done: Set<string>): PlayerStop | null {
  if (now <= before || now - before > 3) return null;
  return stops.find((stop) => !done.has(stop.id) && stop.at > before && stop.at <= now) ?? null;
}

/** The learner's switch, kept in their browser for every lesson: off while listening away from the computer. */
const STOPS_KEY = "adc_lesson_stops";

export function readStopsOn(): boolean {
  try {
    return window.localStorage.getItem(STOPS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeStopsOn(on: boolean) {
  try {
    window.localStorage.setItem(STOPS_KEY, on ? "on" : "off");
    window.dispatchEvent(new Event(STOPS_KEY));
  } catch {
    // Storage refused: the switch holds for this page only.
  }
}

/** Every player on the page follows the switch, wherever it was turned. */
export function onStopsChange(listener: () => void): () => void {
  window.addEventListener(STOPS_KEY, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(STOPS_KEY, listener);
    window.removeEventListener("storage", listener);
  };
}
