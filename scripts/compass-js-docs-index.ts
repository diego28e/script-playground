// The JavaScript Compass's docs index (docs/compass.md, "JavaScript"): the only links a JavaScript card or its AI may
// give, as python-docs-3.12.json is for Python. Two official sources, read from their own indexes, never guessed:
// - MDN's search index (developer.mozilla.org/en-US/search-index.json): every JavaScript page (the guide and the
//   reference), and the Web API pages of the globals Node also has (fetch, URL, AbortController, setTimeout…).
// - Node.js's API docs for the course's Node (26): every page's headings with the anchors the page itself gives them
//   (`#fspromisesreadfilepath-options`), so a link lands on the exact heading. all.json names the API but not its URLs,
//   so the pages are read for their anchors.
//
//   pnpm exec tsx scripts/compass-js-docs-index.ts [--node 26]
//
// Writes lib/compass/javascript/docs-index.json: [{ key, title, url, source }], `key` being what a card stores.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { node: { type: "string", default: "26" } } });
const NODE = `https://nodejs.org/docs/latest-v${values.node}.x/api/`;
const MDN = "https://developer.mozilla.org";
// Web API pages for globals Node has too: the rest of MDN's Web API is the browser's, not this course's.
const WEB_GLOBALS = /^\/en-US\/docs\/Web\/API\/(fetch|Window\/fetch|URL|URLSearchParams|AbortController|AbortSignal|Window\/setTimeout|setTimeout|Window\/setInterval|setInterval|clearTimeout|Window\/clearTimeout|structuredClone|Window\/structuredClone|console|Console|Performance|performance|queueMicrotask|Window\/queueMicrotask|TextEncoder|TextDecoder|Headers|Request|Response|Blob|DOMException|EventTarget|Event|Crypto|crypto|Crypto_API)(\/|$)/;

type Entry = { key: string; title: string; url: string; source: "mdn" | "node" };

async function get(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "docs-index-builder" }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  const entries: Entry[] = [];

  const mdn = JSON.parse(await get(`${MDN}/en-US/search-index.json`)) as { title: string; url: string }[];
  for (const page of mdn) {
    if (!page.url.startsWith("/en-US/docs/Web/JavaScript") && !WEB_GLOBALS.test(page.url)) continue;
    entries.push({ key: `mdn:${page.url.replace(/^\/en-US\/docs\//, "")}`, title: page.title, url: `${MDN}${page.url}`, source: "mdn" });
  }
  const mdnCount = entries.length;

  const index = await get(`${NODE}index.html`);
  const pages = [...new Set([...index.matchAll(/href="?([a-z0-9_]+)\.html/g)].map((match) => match[1]))].filter((page) => !["index", "all", "documentation", "synopsis"].includes(page));
  for (const page of pages) {
    const html = await get(`${NODE}${page}.html`);
    // The module's name, from the page's own <title> ("File system | Node.js v26.13.1 Documentation").
    const title = decode(html.match(/<title>([^<|]+)/)?.[1] ?? page).trim();
    entries.push({ key: `node:${page}`, title: `${title} (Node.js ${values.node})`, url: `${NODE}${page}.html`, source: "node" });
    // A heading: its text, then the page's own anchor for it (`<a class=mark id=X href=#X>#</a>`).
    for (const match of html.matchAll(/<h([2-5])[^>]*>([\s\S]*?)<\/h\1>/g)) {
      const anchor = match[2].match(/class="?mark"?\s+id="?([^"\s>]+)"?/)?.[1];
      if (!anchor) continue;
      const heading = decode(match[2].replace(/<span>[\s\S]*?<\/span>/g, "")).replace(/#$/, "").trim();
      if (!heading) continue;
      entries.push({ key: `node:${page}#${anchor}`, title: heading, url: `${NODE}${page}.html#${anchor}`, source: "node" });
    }
  }

  const unique = [...new Map(entries.map((entry) => [entry.key, entry])).values()];
  writeFileSync(join(process.cwd(), "lib", "compass", "javascript", "docs-index.json"), `${JSON.stringify(unique)}\n`);
  console.log(`${unique.length} entries: ${mdnCount} from MDN, ${unique.length - mdnCount} from Node.js ${values.node} (${pages.length} pages).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
