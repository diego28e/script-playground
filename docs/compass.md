# Python Compass

So learners of the LangChain course are never held back by Python: the platform recognises the Python in any code and
brings the explanation to the learner, the same explanation everywhere, then practises it until it sticks. Groundwork
for a Python course later, and for other languages after that. ("Compass" is a working name.) Decided with the admin on
2026-11-10.

## The idea

- **Cards**: a small, curated set of concept cards (about 150 to 250), not a copy of the docs. Each has our own
  beginner-friendly explanation in Spanish and English, a minimal example **proven on the grader** (it must print what
  the card says) and a common mistake that must fail as described, links to the exact official docs anchors (checked
  against the docs index, never invented), and the LangChain lessons where it shows up. One source of truth: the video
  guide's "explain Python syntax in one sentence", the tutor, practice recipes and the scratchbook AI explain a
  construct the same way.
- **Code lens**: the detector (below) knows which constructs any code uses and on which lines, so the platform can
  offer "explain this line" chips on code, explain errors by the construct on the failing line, and show "Python you'll
  meet in this lesson".
- **Loop**: cards become practice skills (a Python track in the practice graph, with spaced repetition), and the
  missing-prerequisite diagnosis can propose them.
- **Ways in**: search anywhere (keywords and plain questions), an "Ask Python" chat answering from the cards and the
  pinned docs with verified links and a runnable "Try it", the code lens' chips, and error explanations.

Not a docs MCP server for learners at runtime (no control over version, voice or beginner-friendliness); docs tooling
helps on the authoring side, and the cards could later be published as our own MCP server.

## Ranking: course use first, learners' struggles over time

The first cards are chosen by what the course asks of learners (the inventory, available now, no learner data needed);
learners' signals (`CompassSignal`) are collected from the first surface on and re-rank the cards (`demand`), and
searches that find nothing become the list of cards to write next.

## Built so far (2026-11-10)

| Piece | Where | What |
|---|---|---|
| The detector | `lib/compass/detector.py` | Python's own parser (`ast`) names the constructs in code and their lines: about 150 concepts (f-strings, comprehensions, `**kwargs`, type hints, decorators, `await`, the `\|` of LangChain chains as operator overloading while `int \| None` in a hint is a type…), plus the standard library and everyday packages by import. Standard library only; reads notebook cells (`%pip` lines and top-level `await` included). `python -I lib/compass/detector.py` reads code on stdin and prints JSON: the code lens can run it in the grader. Labels in English and Spanish (`CONCEPTS`, `LABELS_ES`). |
| The course inventory | `scripts/compass-inventory.py` → `lib/compass/course-inventory.json` and `.md` | Every lesson and project notebook of the course repository, in course order (code cells and the Python blocks of Markdown cells; setup cells, `# Setup N:`, counted apart since learners run them without studying them; solutions apart): per concept, how many lessons teach with it, where it first appears, an example line, and its rank, the cards' starting order. Per notebook, the concepts it uses ("Python you'll meet in this lesson"). |
| The docs index | `scripts/compass-docs-index.py` → `lib/compass/python-docs-3.12.json` | The official Python 3.12 docs' own index (`objects.inv`): 12,241 names with their exact URLs (functions, methods, modules, glossary terms, the reference's sections). The only links a card or the AI may give. 3.12 is the lab's Python. |
| The tables | `prisma/schema.prisma`, migration `python_compass` | `CompassConcept` (one per detector key: labels, the course's rank, lesson count and first lesson, learners' `demand`), `CompassCard` (versioned: content, proven examples, verified docs links, related concepts, the grader's proof; DRAFT → PROVEN → PUBLISHED → RETIRED), `CompassSignal` (searches, empty searches, card views, explain-this-line, run errors, questions, practice misses). `language` is "python" for now. |
| Loading the concepts | `lib/compass/concepts.ts` (`syncConcepts`), `scripts/compass-sync.ts` | Upserts the concepts from the inventory; never touches cards or signals. |

First inventory (course repository at `b06f6fb`, 129 notebooks): the basics are everywhere from 00.01, and the
course is dense early: generator expressions with nested unpacking, type hints and keyword arguments in 00.01;
decorators in 54 lessons from 00.07, classes in 53, `try`/`except` in 67, `lambda` in 63, Pydantic models in 25 from
01.04, the `|` of chains in 24 from 01.01, `await` in 21 from 01.05. See `lib/compass/course-inventory.md`.

### Regenerating

From the platform's root, with a checkout of the course repository:

```bash
python -I scripts/compass-inventory.py <course repository checkout>
python -I scripts/compass-docs-index.py --version 3.12
npx tsx scripts/compass-sync.ts
```

On a deployed platform, Admin → Python's **Inventory** button does what `compass-sync.ts` does, from the inventory
bundled with that version.

## Cards (built 2026-11-10)

**Admin → Python** (`/admin/python`, `actions/compass.ts`, `components/admin/compass/`): every concept in the course's
order of use, with its card's status (no card, draft, proven, published, and which version learners see); search and
filters by group and status; **Draft the next 5** (the most used concepts without a card, drafted one after another,
each one request) and **Inventory** (reload the concepts).

**A concept's page** (`/admin/python/<key>`): the form on the left, the **learner's view** on the right (Spanish or
English, `components/compass/concept-card.tsx`, the component the guide's pages will reuse), the versions above.

- **Draft with AI** (`lib/compass/cards.ts`, `draftCard`): Sonnet by default (about 15 s; Opus is offered but slow).
  The model gets the concept, how the course uses it (lessons, first lesson, a real line), the **docs candidates**
  (`lib/compass/docs.ts`: the index entries most likely to explain it, the tutorial and glossary first, grammar
  tokens, parser internals and release notes left out; packages get their official sites) and every concept's key. It
  writes the card in the platform's voice (the video guide's: calm, precise, warm; no "simply" or "just"; Spanish with
  technical terms in English), true on Python 3.12. A link or related concept it invents is dropped, and said so.
- **Rewrite with AI**: the version shown, rewritten following one instruction ("mistake 2 really raises ValueError…").
- **The card**: title, one-sentence summary, explanation (Markdown, 80 to 180 words), when to reach for it, 1 to 3
  examples (code and exactly what it prints), 0 to 2 common mistakes (code that raises a named exception, or prints
  something unintended, with why and how to write it), 1 to 4 docs links (index keys only), related concepts.
- **Prove** (`proveCard`): every example and mistake runs on the grader; an example must print exactly its output
  without an error, a mistake must raise its exception or print exactly its output. All pass: **PROVEN**. When an
  output differs, **Use the real outputs** takes what the code really printed (the code is the truth) and proves again;
  a wrong exception is the admin's (or a rewrite's) to fix.
- **Publish**: only a proven version; the version published before is retired. Editing a proven or published version
  saves a new draft version; the published one stays live until the new one is published.

First run (local, 2026-11-10): the f-strings draft written before the prompt said "true on Python 3.12" claimed a
mistake raised a SyntaxError that 3.12 accepts, and another that raised a ValueError: the proof caught both, a
one-line rewrite fixed it, and it was published. The next five (print, strings, assignment, indexing, keyword
arguments) were proven on the first try, 4 of 4 each.

## The guide and the signals (built 2026-11-10)

**The guide** (`/python`, "Python" in the site's menu, open to everyone; `lib/compass/guide.ts`,
`components/compass/`): only published cards. The home is search first (a learner comes with a question), then every
card in the order the course uses them. The search runs in the browser over the published cards (names, titles,
summaries, explanations, in both languages, accents ignored), so it answers as you type. A card's page
(`/python/<key>`) shows it in the learner's language with its examples **runnable**: the code is editable, **Run** (or
Ctrl + Enter) runs it in the scratchbook's sandbox and shows what it printed, the last line's value or the error and its
line; "Back to the example" restores it. Running needs an account; reading doesn't. Related concepts with cards are links.

**The scratchbook's code lens** (`actions/practice-scratch.ts`): the detector runs with every scratchbook run, in the
same grader request (`lib/compass/detector-source.ts`, generated from `detector.py` by
`scripts/compass-detector-source.ts`: regenerate it after changing the detector). Under each run, **In your code** links
the constructs it uses to their published cards, and after an error **About this error** links the construct on the
failing line (the most specific one: not one of those on nearly every line, `lib/compass/everywhere.ts`).

**Signals** (`lib/compass/signals.ts`, `CompassSignal`), recorded quietly, never in the learner's way:
- `SEARCH`: a search the learner settled on (a pause of 1.5 s, or Enter), with its top result; `empty` when nothing
  matched.
- `CARD_VIEW`: a card opened, with where from: the guide, a lesson (`?from=lesson`) or the scratchbook
  (`?from=scratchbook`).
- `RUN_ERROR`: code that raised in the scratchbook or in a card's example, with the error type and the concept on the
  failing line.

**Back to the admin**: Admin → Python shows each concept's errors, searches and views over the last 90 days, sorts by
**Most needed by learners** (errors weigh 3, searches 2, views 1), and lists **what learners looked for and found no
card**, the cards to write or publish next.

## Python in this lesson (built 2026-11-10)

On the page of a lesson or project with a notebook, before the videos, **Python in this lesson** names the Python its notebook uses
(`lib/compass/lesson.ts`, `components/compass/lesson-python.tsx`), read from the course inventory, so no notebook is
parsed when the page loads:
- **New here**: the constructs this notebook uses for the first time in the course (the inventory's `firstLesson`), the
  most used across the course first. With a published card they're solid chips, to look up before starting.
- **Also uses**: constructs met in earlier lessons that have a published card, the least used first (the ones a learner
  is likeliest to have forgotten).

Constructs on nearly every line (`lib/compass/everywhere.ts`) and solution notebooks are left out. A chip with a card
opens it in a new tab with `?from=lesson`, so its view is counted as coming from the lesson; one without a card is
named all the same, dashed, with "Its card is coming soon". A row folds behind "+N more" past 8 chips, only when that
hides 3 or more. A lesson without a notebook, or with nothing to name, shows no section.

The concept `dataclass` is now labelled "Dataclasses (@dataclass)": next to the module `dataclasses` the two read the
same. In production, press **Inventory** in Admin → Python once after deploying, so the stored label follows.

## Next

1. **Publish the first 20 to 30 cards**, the most used first, then follow "Most needed".
2. **More signals**: practice code tasks' errors (`PRACTICE_MISS`) and the tutor's questions about Python.
3. **The code lens elsewhere**: explain this line on lesson code.
4. **The practice track**: cards as practice skills, and the missing-prerequisite diagnosis proposing them.
