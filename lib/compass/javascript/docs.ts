import docsIndex from "./docs-index.json";
import type { DocLink } from "@/lib/compass/docs";

// The only links a JavaScript Compass card or its AI may give (docs/compass.md, "JavaScript"): MDN's JavaScript pages
// and the Web API pages of Node's globals, and Node.js 26's API docs to the heading, read from their own indexes by
// scripts/compass-js-docs-index.ts. TypeScript's own docs aren't indexed (decided 2026-11-22): a card about type syntax
// may have no link. Server only: the index is about 1.2 MB.

type Entry = { key: string; title: string; url: string; source: "mdn" | "node" };
const ENTRIES = docsIndex as Entry[];
const BY_KEY = new Map(ENTRIES.map((entry) => [entry.key, entry]));

export const DOCS_NAME = "MDN and the Node.js 26 docs";

const JS = "mdn:Web/JavaScript/Reference/";
const OPERATOR = (page: string) => `${JS}Operators/${page}`;
const STATEMENT = (page: string) => `${JS}Statements/${page}`;
const GUIDE = (page: string) => `mdn:Web/JavaScript/Guide/${page}`;

// The pages that explain a syntax concept, by its key: the reference page first, then the guide's.
const PAGES: Record<string, string[]> = {
  const: [STATEMENT("const")],
  let: [STATEMENT("let")],
  var: [STATEMENT("var")],
  "template-literal": [`${JS}Template_literals`],
  "tagged-template": [`${JS}Template_literals`],
  "numeric-separator": [`${JS}Lexical_grammar`],
  "bigint-literal": [`${JS}Global_Objects/BigInt`],
  "strict-equality": [OPERATOR("Strict_equality"), OPERATOR("Strict_inequality"), GUIDE("Equality_comparisons_and_sameness")],
  "loose-equality": [OPERATOR("Equality"), GUIDE("Equality_comparisons_and_sameness")],
  comparison: [OPERATOR("Less_than"), OPERATOR("Greater_than_or_equal")],
  "logical-and": [OPERATOR("Logical_AND")],
  "logical-or": [OPERATOR("Logical_OR")],
  "logical-not": [OPERATOR("Logical_NOT")],
  "double-negation": [OPERATOR("Logical_NOT")],
  "nullish-coalescing": [OPERATOR("Nullish_coalescing")],
  "logical-assignment": [OPERATOR("Nullish_coalescing_assignment"), OPERATOR("Logical_OR_assignment")],
  "compound-assignment": [OPERATOR("Addition_assignment"), GUIDE("Expressions_and_operators")],
  exponent: [OPERATOR("Exponentiation")],
  remainder: [OPERATOR("Remainder")],
  "increment-decrement": [OPERATOR("Increment"), OPERATOR("Decrement")],
  ternary: [OPERATOR("Conditional_operator")],
  "typeof-operator": [OPERATOR("typeof")],
  "instanceof-operator": [OPERATOR("instanceof")],
  "in-operator": [OPERATOR("in")],
  "delete-operator": [OPERATOR("delete")],
  "void-operator": [OPERATOR("void")],
  "comma-operator": [OPERATOR("Comma_operator")],
  "bitwise-operator": [OPERATOR("Bitwise_OR"), OPERATOR("Bitwise_AND")],
  "optional-chaining": [OPERATOR("Optional_chaining")],
  if: [STATEMENT("if...else")],
  else: [STATEMENT("if...else")],
  "else-if": [STATEMENT("if...else")],
  switch: [STATEMENT("switch")],
  "switch-default": [STATEMENT("switch")],
  "break-switch": [STATEMENT("break"), STATEMENT("switch")],
  "break-loop": [STATEMENT("break")],
  continue: [STATEMENT("continue")],
  label: [STATEMENT("label")],
  "for-loop": [STATEMENT("for"), GUIDE("Loops_and_iteration")],
  "for-of": [STATEMENT("for...of")],
  "for-in": [STATEMENT("for...in")],
  "for-await-of": [STATEMENT("for-await...of")],
  while: [STATEMENT("while")],
  "do-while": [STATEMENT("do...while")],
  "bare-return": [STATEMENT("return")],
  "function-declaration": [STATEMENT("function"), GUIDE("Functions")],
  "function-expression": [OPERATOR("function"), GUIDE("Functions")],
  "arrow-function": [`${JS}Functions/Arrow_functions`],
  "default-parameter": [`${JS}Functions/Default_parameters`],
  "rest-parameter": [`${JS}Functions/rest_parameters`],
  "function-returning-function": [GUIDE("Functions"), `${JS}Functions`],
  recursion: [GUIDE("Functions")],
  iife: [GUIDE("Functions")],
  "generator-function": [STATEMENT("function*"), GUIDE("Iterators_and_generators")],
  yield: [OPERATOR("yield")],
  "object-destructuring": [OPERATOR("Destructuring")],
  "destructuring-default": [OPERATOR("Destructuring")],
  "destructuring-rename": [OPERATOR("Destructuring")],
  "destructured-parameter": [OPERATOR("Destructuring")],
  "destructured-parameter-default": [OPERATOR("Destructuring"), `${JS}Functions/Default_parameters`],
  "rest-destructuring": [OPERATOR("Destructuring")],
  "array-destructuring": [OPERATOR("Destructuring")],
  "array-destructuring-hole": [OPERATOR("Destructuring")],
  "object-spread": [OPERATOR("Spread_syntax")],
  "array-spread": [OPERATOR("Spread_syntax")],
  "spread-call": [OPERATOR("Spread_syntax")],
  "shorthand-property": [OPERATOR("Object_initializer")],
  "method-shorthand": [`${JS}Functions/Method_definitions`],
  "computed-property": [OPERATOR("Object_initializer")],
  "bracket-access": [OPERATOR("Property_accessors")],
  length: [`${JS}Global_Objects/Array/length`, `${JS}Global_Objects/String/length`],
  size: [`${JS}Global_Objects/Map/size`, `${JS}Global_Objects/Set/size`],
  class: [`${JS}Classes`, GUIDE("Using_classes")],
  "class-extends": [`${JS}Classes/extends`],
  constructor: [`${JS}Classes/constructor`],
  "private-member": [`${JS}Classes/Private_elements`],
  "static-member": [`${JS}Classes/static`],
  getter: [`${JS}Functions/get`],
  setter: [`${JS}Functions/set`],
  "static-block": [`${JS}Classes/Static_initialization_blocks`],
  "class-field": [`${JS}Classes/Public_class_fields`],
  "arrow-class-field": [`${JS}Classes/Public_class_fields`, `${JS}Functions/Arrow_functions`],
  "super-call": [OPERATOR("super")],
  "super-method": [OPERATOR("super")],
  this: [OPERATOR("this")],
  "new-own-class": [OPERATOR("new"), GUIDE("Using_classes")],
  throw: [STATEMENT("throw")],
  "try-catch": [STATEMENT("try...catch"), GUIDE("Control_flow_and_error_handling")],
  finally: [STATEMENT("try...catch")],
  "catch-without-variable": [STATEMENT("try...catch")],
  await: [OPERATOR("await"), GUIDE("Using_promises")],
  "top-level-await": [OPERATOR("await")],
  "async-function": [STATEMENT("async_function"), GUIDE("Using_promises")],
  "async-arrow": [OPERATOR("async_function"), `${JS}Functions/Arrow_functions`],
  "regex-literal": [`${JS}Global_Objects/RegExp`, GUIDE("Regular_expressions")],
  "regex-global": [`${JS}Global_Objects/RegExp/global`],
  "regex-capture-group": [`${JS}Regular_expressions/Capturing_group`, GUIDE("Regular_expressions/Groups_and_backreferences")],
  import: [STATEMENT("import"), GUIDE("Modules")],
  "default-import": [STATEMENT("import")],
  "namespace-import": [STATEMENT("import")],
  "import-rename": [STATEMENT("import")],
  "side-effect-import": [STATEMENT("import")],
  "default-and-named-import": [STATEMENT("import")],
  "dynamic-import": [OPERATOR("import")],
  "import-meta": [OPERATOR("import.meta")],
  "export-list": [STATEMENT("export")],
  "re-export": [STATEMENT("export")],
  "export-default": [STATEMENT("export")],
};

// The Node page a `node:` module is documented on.
const NODE_PAGE: Record<string, string> = { "fs/promises": "fs", "timers/promises": "timers", "assert/strict": "assert", "stream/promises": "stream", "dns/promises": "dns", "readline/promises": "readline", child_process: "child_process", http: "http", net: "net" };

/** A link from the index by its key; null when it doesn't exist: the guard against invented links. */
export function docLink(key: string): DocLink | null {
  const entry = BY_KEY.get(key);
  return entry ? { key: entry.key, url: entry.url, title: entry.title } : null;
}

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_.$]+/).filter((word) => word.length > 1);
const STOP = new Set(["the", "and", "or", "of", "in", "a", "an", "to", "with", "on", "for", "at", "your", "own", "with", "when"]);

/** The pages that most likely explain a concept, best first: its own pages, then the index's best title matches. */
export function docCandidates(concept: { key: string; labelEn: string }, limit = 24): DocLink[] {
  const exact: string[] = [...(PAGES[concept.key] ?? [])];
  const [family, ...rest] = concept.key.split(":");
  const name = rest.join(":");
  if (family === "member") {
    const [object, member] = name.split(".");
    exact.push(`${JS}Global_Objects/${object}/${member}`, `mdn:Web/API/console/${member}_static`, `mdn:Web/API/${object}/${member}_static`);
    if (object === "process") exact.push(`node:process#process${member.toLowerCase()}`);
    if (object === "assert") exact.push(`node:assert#assert${member.toLowerCase()}actual-expected-message`, `node:assert#assert${member.toLowerCase()}fn-error-message`);
  }
  if (family === "method") for (const owner of ["Array", "String", "Map", "Set", "RegExp", "Date", "Promise", "Function", "Number", "Object"]) exact.push(`${JS}Global_Objects/${owner}/${name}`);
  if (family === "new") exact.push(`${JS}Global_Objects/${name}/${name}`, `${JS}Global_Objects/${name}`, `mdn:Web/API/${name}/${name}`, `mdn:Web/API/${name}`, ...["http", "net"].map((page) => `node:${page}#class-${page}${name.toLowerCase()}`));
  if (family === "call") exact.push(`${JS}Global_Objects/${name}/${name}`, `${JS}Global_Objects/${name}`, `mdn:Web/API/Window/${name}`, `mdn:Web/API/${name}`);
  if (family === "node") exact.push(`node:${NODE_PAGE[name] ?? name.split("/")[0]}`);
  // Type syntax: TypeScript's docs aren't in the index, so only what JavaScript itself documents.
  if (family === "utility" || concept.key.endsWith("-type") || ["type-annotation", "return-type", "type-alias", "interface", "satisfies"].includes(concept.key)) {
    return exact.map(docLink).filter((link): link is DocLink => link !== null);
  }

  const found = new Map<string, { link: DocLink; score: number }>();
  exact.forEach((key, index) => {
    const link = docLink(key);
    if (link && !found.has(key)) found.set(key, { link, score: 100 - index });
  });
  const tokens = new Set([...words(concept.labelEn), ...words(name || concept.key.replaceAll("-", " "))].filter((word) => !STOP.has(word)));
  if (tokens.size) {
    for (const entry of ENTRIES) {
      if (found.has(entry.key)) continue;
      const title = words(entry.title);
      let score = 0;
      for (const token of tokens) if (title.includes(token)) score += 1;
      if (score < Math.min(2, tokens.size)) continue;
      if (entry.key.startsWith(JS)) score += 1;
      else if (entry.key.startsWith("mdn:Web/JavaScript/Guide/")) score += 0.5;
      found.set(entry.key, { link: { key: entry.key, url: entry.url, title: entry.title }, score });
    }
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.link.key.length - b.link.key.length)
    .slice(0, limit)
    .map(({ link }) => link);
}
