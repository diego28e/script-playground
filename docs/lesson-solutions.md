# Folded solutions on lesson pages

Some courses are practised by not reading the solution first. The "Live-Coding Interview Challenges in TypeScript"
course is one: each lesson is an interview challenge, and its `## Solutions` section holds the talk-through, the
reference solution and the model answers. A course like this can fold that section on its lesson pages.

## Using it

- **Admin → Courses**, the course's card, **Lesson pages → Fold solutions**. It's off for every course until it's
  turned on, so the TypeScript course's lessons, which end with `## Solutions` behind a spoiler line, stay as they are.
- On a reading lesson of a course with it on, everything from the `## Solutions` heading to the end of the lesson is
  folded. The heading stays, with a note ("Try it on your own first…") and **Show solutions**. Pressed, it opens the
  section, and turns into **Hide solutions**.
- A lesson without a `## Solutions` heading is shown whole. A `## Solutions` line inside a code block doesn't count.

## How it works

- `Course.foldSolutions` (migration `20261126180000_fold_solutions`), set by `setCourseFoldSolutions`
  (`actions/course-access.ts`), which refreshes the course's pages.
- The lesson page renders the Markdown on the server (`components/courses/lesson-markdown.tsx`). With the setting on,
  `splitAtSolutions` (`lib/lesson-sections.ts`) splits it at the heading; what follows is rendered there too, and
  passed into `SolutionsFold` (`components/courses/solutions-fold.tsx`), the only part that runs in the browser.
- The folded section is on the page all along, hidden, so:
  - its headings keep their anchors: opening the page at one (`…#the-reference-solution`), or following a link to it,
    opens the fold and scrolls there;
  - printing shows everything, and the note and the button aren't printed.
- The button is a real button with `aria-expanded` and `aria-controls`, so it works from the keyboard and a screen
  reader says whether the section is open. It's in the language picked for the site.
- It only hides the solutions on the page. The AI features still read them, by choice (2026-11-26): the lesson's
  teacher and the practice coach get them after the problem (`docs/lesson-tutor.md`), and the whiteboard teaches from
  them.

The checks are in `pnpm board:check` ("the page folds from the ## Solutions heading to the end").
