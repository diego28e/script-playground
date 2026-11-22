# Private courses

A course is **public** (everyone sees it in the catalog and can enrol) or **private**: it only exists for the people
whose email is on its access list, and for admins. Every course is public unless it is made private.

## What "private" means

For someone who isn't on the list, a private course doesn't exist:

| Where | What they get |
|---|---|
| The catalog (`/courses`) | The course isn't listed |
| Its page, its lessons, its practice pages | "Not found", the same as a slug that was never used. Nothing says "you don't have access", and the browser tab's title doesn't name it |
| Enrolling, lesson progress, practice, the scratchbook's AI | Refused as "not found" |
| The lab | No `course:<slug>` group, and the enrolment doesn't count towards the `lab` group |
| The AI tutor | It gets no lesson or course outline for the notebook |

For someone on the list it is a normal course: it is in their catalog with a "Private" mark, and they enrol as usual.

Rules worth knowing:

- **The list is by email**, the one the person signs in with. An email can be added before the person has an account;
  the course is there from their first sign-in. Emails are compared in lower case, exactly: `ana@gmail.com` and
  `ana+sre@gmail.com` are two different people to the list.
- **The email must be verified by the sign-in provider.** Sign-in is with Google, which always verifies it. This is so
  that, if another way to sign up is ever added, nobody can open a course by typing someone else's address.
- **Admins always see every course.** They manage its videos and practice in the admin area anyway. A private course
  with an empty list is therefore open to admins only.
- **Being enrolled is not enough.** Taking someone off the list (or making a public course private) closes the course
  for them at once: pages, practice and the lab. Their enrolment and progress are kept, and come back if they are
  added again.
- **A draft is still a draft.** A course that isn't published is seen by nobody, whatever its visibility.
- **Making a course public keeps its list**, in case it is made private again; the list has no effect meanwhile.

## Using it

**Admin → Courses** (`/admin/courses`) lists every course, drafts too:

- **Who can see it**: "Everyone" or "Only people I add". Either change asks first. Making a course private says how
  many enrolled people aren't on the list and would lose it.
- **People with access**: add one email or paste several (commas, spaces or new lines). Each person shows whether they
  have an account yet and whether they are enrolled. Emails that can't be read stay in the box to be fixed; the rest
  are added.
- **Publish** and **Back to draft** (beside the status, `setCourseStatus`, added 2026-11-22). Each asks first and says
  who will see it: for a private course, still only its list and admins (or admins alone while the list is empty); for
  a public one, everyone. Back to draft hides it from everyone but admins and keeps every enrolment and all progress, for
  when it is published again. Before this, a course was only published by importing it with `--publish`.

**A course that must never be public** is made private on its first import, before it is published, then published
from Admin → Courses when it's ready (`--publish` still works on an import too):

```bash
pnpm course:import --repo <path> --private            # a private draft
```

An import never makes a course public again; that is only done from Admin → Courses. Without `--private`, an import
leaves the visibility as it is (a new course starts public).

**A course that isn't on GitHub** (the TypeScript and NestJS course, 2026-11-22) imports from its folder all the same:
the importer reads the files and the folder's git commit, and stores each guide's text in the database. With no `origin`
remote it has no repository link (nothing to hide), and its slug must be given, since the folder's name would be used
otherwise:

```bash
pnpm course:import --repo <path to the folder> --slug typescript-nestjs-course --private
```

The importer reads a guide's "## Learning objectives" numbered list too (added 2026-11-22; the TypeScript course's 111
lessons have one, the other courses' guides none), so the course page shows them and drafting gets them. Only notebooks
in the lab need the repository on GitHub (a private repository, `infra/lab/start-lab.sh`); this course has none.

## How it works

- `Course.visibility` (`PUBLIC` | `PRIVATE`) and `CourseAccess` (`courseId`, `email`), in `prisma/schema.prisma`.
- **The rule is written once**, in `lib/course-access.ts`: `courseVisibleTo(viewer)` returns the Prisma `where` of the
  courses a person may see. Every query that reads a course for a person spreads it into its own `where`, next to the
  status or the slug. A new feature that reads a course for a learner must do the same.
- **Who is asking comes from the session, on the server** (`lib/viewer.ts`, `currentViewer()`), never from an argument:
  the functions in `actions/` are server actions, so their arguments can come from anyone. Where there is no request
  (the lab's sign-in claims, the tutor in the learning service), `viewerById(userId)` loads the same shape.
- Where it is applied: the catalog, a course's page and enrolling (`actions/courses.ts`); a lesson and its progress
  (`actions/lessons.ts`); practice (`actions/practice-learner.ts`, the pages under `app/(main)/practice/`, the header's
  badge in `lib/practice/learner.ts`); the scratchbook's AI (`actions/practice-scratch.ts`); the lab's groups
  (`lib/lab-access.ts`); the tutor's course context (`lib/tutor/harness.ts`).
- Videos need nothing more: a lesson's media URLs are signed when its page is rendered, and the page is only rendered
  for someone who may see the course.
- The admin side is `actions/course-access.ts` and `components/admin/course-access-manager.tsx`.

## Limits today

- **Notebooks in the lab.** A student's lab clones one course repository on its first start (`infra/lab/start-lab.sh`).
  A private course's readings, videos and practice work as they are; giving it notebooks in the lab needs the lab to
  clone a second, private repository for the people in its `course:<slug>` group.
- **The tutor in the lab** reads this rule from the learning service's own build. After deploying this to the platform,
  rebuild the learning service (`infra/lab/README.md`) before a private course has notebooks in the lab.
- **The repository is never linked.** A private course's page and lesson pages show no "View on GitHub", and a guide's
  links to other files of its repository are plain text (`sourceForLearners` in `lib/course-access.ts`, applied in
  `actions/courses.ts` and `actions/lessons.ts`). The repository can still be private on GitHub; the platform only reads
  it on the server, for admins' work (drafting, video briefs). Public courses keep their links.
