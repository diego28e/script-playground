import docsIndex from "./python-docs-3.12.json";

// The only links a Compass card or its AI may give (docs/compass.md): the official Python docs' own index for the
// Python version the course runs (scripts/compass-docs-index.py), and the official sites of the everyday packages,
// which aren't in Python's docs. Server only: the index is about 2 MB.

export type DocLink = { key: string; url: string; title: string };

const INDEX = docsIndex as unknown as { version: string; entries: Record<string, { url: string; title: string }> };
export const DOCS_VERSION = INDEX.version;

// Third-party packages' own documentation, by the detector's "package:<name>" key.
const PACKAGE_DOCS: Record<string, DocLink> = {
  "package:pydantic": { key: "pkg:pydantic", url: "https://docs.pydantic.dev/latest/", title: "Pydantic documentation" },
  "package:dotenv": { key: "pkg:dotenv", url: "https://pypi.org/project/python-dotenv/", title: "python-dotenv" },
  "package:pandas": { key: "pkg:pandas", url: "https://pandas.pydata.org/docs/", title: "pandas documentation" },
  "package:numpy": { key: "pkg:numpy", url: "https://numpy.org/doc/stable/", title: "NumPy documentation" },
  "package:requests": { key: "pkg:requests", url: "https://requests.readthedocs.io/", title: "Requests documentation" },
  "package:httpx": { key: "pkg:httpx", url: "https://www.python-httpx.org/", title: "HTTPX documentation" },
  "package:matplotlib": { key: "pkg:matplotlib", url: "https://matplotlib.org/stable/", title: "Matplotlib documentation" },
  "package:pytest": { key: "pkg:pytest", url: "https://docs.pytest.org/", title: "pytest documentation" },
  "package:IPython": { key: "pkg:IPython", url: "https://ipython.readthedocs.io/", title: "IPython documentation" },
  "package:tiktoken": { key: "pkg:tiktoken", url: "https://github.com/openai/tiktoken", title: "tiktoken" },
  "package:rich": { key: "pkg:rich", url: "https://rich.readthedocs.io/", title: "Rich documentation" },
};

// Words that help a concept find its pages, beyond its key and label (the docs' own vocabulary).
const HINTS: Record<string, string[]> = {
  "f-string": ["formatted string literals", "f-strings"],
  "f-string-format-spec": ["format specification", "formatspec", "f-strings"],
  "walrus": ["assignment expressions", "named expression"],
  "pipe-operator": ["object.__or__", "special method names", "emulating numeric types", "operator overloading"],
  "tuple-unpacking": ["tuples and sequences", "assignment statements", "unpacking"],
  "starred-unpacking": ["assignment statements", "unpacking"],
  "call-unpacking": ["unpacking argument lists"],
  "keyword-arguments": ["keyword argument", "keyword arguments"],
  "default-arguments": ["default argument values"],
  "kwargs": ["keyword arguments", "arbitrary argument lists", "parameter"],
  "args": ["arbitrary argument lists", "parameter"],
  "keyword-only-arguments": ["keyword-only parameter", "special parameters"],
  "list-comprehension": ["list comprehensions", "list comprehension"],
  "dict-comprehension": ["dictionary comprehension", "comprehensions"],
  "set-comprehension": ["comprehensions", "sets"],
  "generator-expression": ["generator expressions", "generator expression"],
  "comprehension-filter": ["list comprehensions", "comprehensions"],
  "nested-comprehension": ["nested list comprehensions"],
  "type-hints": ["type hint", "annotation", "typing"],
  "return-annotation": ["function annotations", "annotation"],
  "generic-hints": ["generic alias type", "generics"],
  "optional-union": ["union type", "typing.optional"],
  "conditional-expression": ["conditional expressions"],
  "or-default": ["boolean operations"],
  "boolean-operators": ["boolean operations"],
  "identity-is": ["identity comparisons", "comparisons"],
  "membership-in": ["membership test operations"],
  "chained-comparison": ["comparisons"],
  "indexing": ["subscriptions", "sequence types"],
  "slicing": ["slicings", "common sequence operations"],
  "negative-index": ["common sequence operations"],
  "string-methods": ["string methods"],
  "dict-views": ["dictionary view objects"],
  "dict-unpacking": ["dictionary displays", "mapping types"],
  "list-unpacking": ["list displays", "additional unpacking"],
  "method-call-chain": ["calls", "attribute references"],
  "decorator": ["decorator", "function definitions"],
  "docstring": ["documentation strings", "docstring"],
  "lambda": ["lambda expressions", "lambdas"],
  "nested-function": ["nested scopes", "naming and binding"],
  "class-def": ["classes", "class definitions"],
  "inheritance": ["inheritance"],
  "dataclass": ["dataclasses"],
  "pydantic-model": ["pydantic"],
  "typed-dict": ["typing.typeddict"],
  "try-except": ["handling exceptions", "the try statement"],
  "except-as": ["handling exceptions"],
  "raise": ["raising exceptions", "the raise statement"],
  "with-statement": ["the with statement", "context manager"],
  "await": ["await expression", "coroutines", "awaitable"],
  "top-level-await": ["await expression", "coroutines"],
  "async-def": ["coroutine function definition", "coroutines and tasks"],
  "asyncio-run": ["asyncio.run"],
  "asyncio-gather": ["asyncio.gather"],
  "floor-division": ["numeric types", "binary arithmetic operations"],
  "true-division": ["numeric types", "binary arithmetic operations"],
  "modulo": ["binary arithmetic operations"],
  "jupyter-magic": [],
  "from-import": ["the import statement", "modules"],
  "import": ["the import statement", "modules"],
  "triple-quoted-string": ["string and bytes literals", "strings"],
  "string-concatenation": ["text sequence type", "strings"],
  "for-loop": ["for statements", "the for statement"],
  "if-statement": ["if statements", "the if statement"],
  "while-loop": ["the while statement"],
  "break-continue": ["break and continue statements"],
  "match-statement": ["match statements", "the match statement"],
  "generator-function": ["generators", "yield expressions"],
  "property": ["property"],
  "super-call": ["super"],
  "self": ["class objects", "instance objects", "method objects"],
  "init-method": ["object.__init__", "class objects"],
  "dunder-methods": ["special method names"],
  "type-conversion": ["built-in functions", "int", "float", "str"],
};

// Not useful to a learner: grammar tokens, the parser's own classes, release notes, 2to3.
const SKIP = /^(std:token:|std:2to3fixer:|py:class:ast\.|py:data:ast\.|py:data:token\.|std:label:(whatsnew|bpo-|pep-|new-feat))/;

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_.]+/).filter((word) => word.length > 1);
const STOP = new Set(["the", "and", "or", "of", "in", "a", "an", "to", "with", "by", "on", "for", "at", "x", "e"]);

/** A link from the index (or a package's site) by its key; null when it doesn't exist: the guard against invented links. */
export function docLink(key: string): DocLink | null {
  const entry = INDEX.entries[key];
  if (entry) return { key, url: entry.url, title: entry.title };
  return Object.values(PACKAGE_DOCS).find((link) => link.key === key) ?? null;
}

/**
 * The index entries most likely to explain a concept, best first: the tutorial, the glossary and the reference before
 * a library's API, and pages whose names match the concept's words.
 */
export function docCandidates(concept: { key: string; labelEn: string }, limit = 24): DocLink[] {
  if (PACKAGE_DOCS[concept.key]) return [PACKAGE_DOCS[concept.key]];
  const moduleName = concept.key.startsWith("stdlib:") ? concept.key.slice("stdlib:".length) : null;
  const phrases = [concept.key.replace(/^stdlib:/, "").replaceAll("-", " "), concept.labelEn.replace(/[()…"]/g, " "), ...(HINTS[concept.key] ?? [])];
  const tokens = new Set(phrases.flatMap(words).filter((word) => !STOP.has(word)));
  const scored: { link: DocLink; score: number }[] = [];
  for (const [key, entry] of Object.entries(INDEX.entries)) {
    if (SKIP.test(key)) continue;
    const name = key.split(":").slice(2).join(":");
    const haystack = `${name} ${entry.title}`.toLowerCase();
    let score = 0;
    if (moduleName) {
      if (key === `py:module:${moduleName}`) score += 20;
      else if (name.startsWith(`${moduleName}.`)) score += 2;
    }
    for (const phrase of phrases) {
      const lower = phrase.toLowerCase().trim();
      if (lower.length > 2 && (entry.title.toLowerCase() === lower || name.toLowerCase() === lower)) score += 8;
      else if (lower.length > 4 && haystack.includes(lower)) score += 4;
    }
    for (const token of tokens) if (words(haystack).includes(token)) score += 1;
    if (!score) continue;
    if (key.startsWith("std:label:tut-")) score += 2;
    else if (key.startsWith("std:term:")) score += 1.5;
    else if (key.startsWith("std:label:")) score += 1;
    if (key.startsWith("py:function:") && !name.includes(".")) score += 1; // A built-in function.
    scored.push({ link: { key, url: entry.url, title: entry.title }, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.link.key.length - b.link.key.length)
    .slice(0, limit)
    .map(({ link }) => link);
}
