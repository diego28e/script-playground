import { validateItemGroup, validateMedia, type ActivityMedia, type ItemGroup } from "@intellectif/lk-core";
import { MEDIA_PREFIX } from "@/lib/media";

// A lesson's video, as stored in Lesson.video. Course authors write it beside the lesson as
// NN-MM-slug.video.json, in one of two lk-core shapes:
//
// - an interactive video: an item group whose stimulus is the video and whose timeline places quizzes in it
//   (rendered by lk-react's <InteractiveVideo>);
// - a plain video: just the media object ({ "type": "video", "url": ..., "tracks": [...] }), for a video with no
//   questions yet (lk-core needs at least one question for an interactive one).

export type LessonVideo = { kind: "interactive"; group: ItemGroup } | { kind: "plain"; media: ActivityMedia };

/** Reads a stored or authored video. Throws with every problem listed, so an import says exactly what to fix. */
export function parseLessonVideo(value: unknown): LessonVideo {
  const problems: string[] = [];
  let video: LessonVideo | null = null;

  if (value && typeof value === "object" && (value as { type?: unknown }).type === "item-group") {
    const result = validateItemGroup(value);
    if (!result.success) {
      problems.push(...result.errors.map((error) => `${error.path.join(".") || "(group)"}: ${error.message}`));
    } else if (result.data.stimulus?.media?.type !== "video" || !result.data.timeline) {
      problems.push("an item group here must have a video stimulus and a timeline (an interactive video)");
    } else {
      video = { kind: "interactive", group: result.data };
    }
  } else {
    const result = validateMedia(value);
    if (!result.success) {
      problems.push(...result.errors.map((error) => `${error.path.join(".") || "(media)"}: ${error.message}`));
    } else if (result.data.type !== "video") {
      problems.push(`media type is "${result.data.type}"; a lesson video needs "video"`);
    } else {
      video = { kind: "plain", media: result.data };
    }
  }

  // Our own rule on top of lk-core's: a root-relative path must be a course media file. Any other path would
  // point at a page of this site.
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      if (/^\/(?!\/)/.test(node) && !node.startsWith(MEDIA_PREFIX) && /(^|\.)(url|src|poster|captionsUrl)$/.test(path)) {
        problems.push(`${path}: a file path must start with ${MEDIA_PREFIX} (got "${node}")`);
      }
    } else if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}.${index}`));
    } else if (node && typeof node === "object") {
      Object.entries(node).forEach(([key, entry]) => walk(entry, path ? `${path}.${key}` : key));
    }
  };
  walk(value, "");

  if (problems.length || !video) throw new Error(problems.join("\n"));
  return video;
}

/**
 * The title a stored video carries itself, for one with no title of its own and no skill (one from before videos were
 * tied to skills): an interactive video's title, or a plain one's description. Backticks are dropped.
 */
export function storedVideoTitle(stored: unknown): string | null {
  const video = stored as { title?: unknown; alt?: unknown; stimulus?: { media?: { alt?: unknown } } } | null;
  const title = video?.title ?? video?.stimulus?.media?.alt ?? video?.alt;
  return typeof title === "string" && title.trim() ? title.replaceAll("`", "").trim() : null;
}
