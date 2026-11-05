import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

// Course media (lesson videos, their captions and posters) lives in a private S3 bucket behind CloudFront
// (infra/media). Lesson content refers to a file by a root-relative path under /media/, for example
// "/media/courses/<course>/<lesson>/v1/video.mp4"; this module turns those paths into URLs a browser can load.
//
// - Production: MEDIA_BASE_URL is the distribution (https://media.academiadelcodigo.com) and every URL is signed
//   with the CloudFront key pair, so a link stops working after a few hours and cannot be embedded elsewhere.
// - Local development: with no MEDIA_BASE_URL the paths stay as they are and Next serves them from public/media
//   (gitignored), so a video can be tried before anything is uploaded.

export const MEDIA_PREFIX = "/media/";

// URLs expire on a fixed grid, so every page view in the same window gets the same URL and the browser keeps its
// cache. A link stays valid for 6 to 12 hours: longer than any lesson, short enough to be useless when shared.
const WINDOW_MS = 6 * 60 * 60 * 1000;

function signer() {
  const base = process.env.MEDIA_BASE_URL?.replace(/\/+$/, "");
  if (!base) return null;
  const keyPairId = process.env.MEDIA_KEY_PAIR_ID;
  const encodedKey = process.env.MEDIA_PRIVATE_KEY_B64;
  if (!keyPairId || !encodedKey) {
    throw new Error("MEDIA_BASE_URL is set but MEDIA_KEY_PAIR_ID or MEDIA_PRIVATE_KEY_B64 is missing");
  }
  const privateKey = Buffer.from(encodedKey, "base64").toString("utf8");
  const dateLessThan = new Date((Math.floor(Date.now() / WINDOW_MS) + 2) * WINDOW_MS).toISOString();
  return (path: string) => {
    // Keys are written as plain paths; encode each segment so a space or an accent can't break the signature.
    const key = path.slice(MEDIA_PREFIX.length).split("/").map(encodeURIComponent).join("/");
    return getSignedUrl({ url: `${base}/${key}`, keyPairId, privateKey, dateLessThan });
  };
}

/**
 * Returns a copy of `value` (a lesson's video: an lk-core item group or media object) with every /media/ path
 * replaced by a loadable URL. Absolute URLs and everything else are left untouched.
 */
export function resolveMediaUrls<T>(value: T): T {
  const sign = signer();
  if (!sign) return value;
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return node.startsWith(MEDIA_PREFIX) ? sign(node) : node;
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, walk(entry)]));
    }
    return node;
  };
  return walk(value) as T;
}
