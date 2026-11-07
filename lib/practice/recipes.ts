import { prisma } from "@/lib/prisma";
import type { SessionItem } from "@/lib/practice/learner";
import type { TaskContent } from "@/lib/practice/tasks";

// Recipes (docs/practice.md, "Recipes"): a code task's steps to the solution in plain words. At a skill's first stages
// they're open, guiding the learner; at later stages (writing it yourself, applying it, transferring it) recall is
// what's practised, so the recipe waits behind a button and showing it counts like a hint in the answer's evidence
// (hint 0 of the task, beside the up to three written hints).

/** Stages where the recipe is open; at the others it's earned. */
const OPEN_STAGES = new Set(["recognise", "recall", "produce", "example", "complete"]);
export const RECIPE_HINT_NUMBER = 0;

export type RecipeView = { open: true; es: string[]; en: string[] } | { open: false } | null;

/** What the page gets of a task's recipe: the steps when open (or shown already), otherwise only that there is one. */
export function recipeView(content: TaskContent, stage: string, shown: boolean): RecipeView {
  if (content.form !== "code" || !content.recipeEs?.length || !content.recipeEn?.length) return null;
  return OPEN_STAGES.has(stage) || shown ? { open: true, es: content.recipeEs, en: content.recipeEn } : { open: false };
}

/** Shows an earned recipe: recorded as hint 0 of the task, so the answer's evidence counts it. */
export async function revealRecipe(userId: string, sessionId: string, taskId: string): Promise<{ es: string[]; en: string[] } | { error: string }> {
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, items: true, learner: { select: { userId: true } }, answers: { where: { taskId }, select: { id: true } } },
  });
  if (!session || session.learner.userId !== userId) return { error: "This practice session isn't yours." };
  if (!(session.items as unknown as SessionItem[]).some((item) => item.taskId === taskId)) return { error: "That task isn't in your practice." };
  const task = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: { content: true } });
  const content = task?.content as unknown as TaskContent | undefined;
  if (!content?.recipeEs?.length || !content.recipeEn?.length) return { error: "That task has no recipe." };
  if (!session.answers.length) {
    await prisma.practiceHint.upsert({
      where: { sessionId_taskId_number: { sessionId, taskId, number: RECIPE_HINT_NUMBER } },
      create: { sessionId, taskId, number: RECIPE_HINT_NUMBER, text: "(recipe shown)", model: "recipe" },
      update: {},
    });
  }
  return { es: content.recipeEs, en: content.recipeEn };
}
