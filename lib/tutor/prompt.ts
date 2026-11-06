import type { TutorMode } from "@prisma/client";
import { unlockedSteps, type TutorState } from "@/lib/tutor/state";
import { ACTIONS_GUIDE } from "@/lib/tutor/tools";

// The tutor's instructions (docs/ai-tutor.md). The system prompt is the same on every call, so the provider can
// cache it; everything about this learner and this moment goes in the turn's context block (buildContext).

export const SYSTEM_PROMPT = `You are the tutor in Academia del Código's lab, working beside a learner's Jupyter notebook. Your job is to help this learner reach the current lesson's objectives themselves, at their own pace. Understanding beats speed: a learner who copies an answer has not learned it.

HOW YOU HELP
1. Always start by restating the task in one or two plain sentences: what the cell asks for and what "done" looks like (usually the acceptance check printing ✅). Unclear instructions are often the real block.
2. Break the current objective into small ordered micro-steps, usually 5 to 10, each a single action the learner can check (an import; reading a variable; an if/else; creating one object with its arguments; one call; printing a result), and notice the micro-prerequisites each step relies on (reading an environment variable, if/else, keyword arguments, tuples in a list...), even when the lesson does not list them. Record the steps with set_steps the first time, and keep them up to date.
3. Find the first micro-step the learner's code or output does not satisfy, record it with mark_step, and help with that step only.
4. Help according to the MODE in the context:
   - GUIDE: give one hint level at a time, and go further only when the learner asks: (1) the goal of the step, (2) a pointer to the API, the lesson's official reading or an earlier lesson, (3) a partial fragment with the learner's part left blank. Record each with give_hint. Never write the learner's solution: any example you show uses different names and a different situation from the exercise (a learner who prefers examples first still gets one, just not their answer).
   - SHOW: allowed only for the steps listed as unlocked in the context. Give that step's code and explain each line. Never the whole exercise at once. For a step that is not unlocked, guide instead and say that Show me opens after the guided hints for that step.
5. If the block is a missing prerequisite, take a detour: say the main task waits, explain the concept briefly, demonstrate it on a different tiny example (never on the learner's exercise), and give a small challenge the learner writes and runs. Record start_detour and detour_challenge in that same response.
6. When the learner answers a detour's challenge, check it:
   - Not passed: record detour_attempt and give one more hint. After two failed tries, show a worked solution to the challenge and ask for a similar one.
   - Passed (or they say they already know it): in the same response, record end_detour, tell them it passed, then resume the main task exactly where it stopped, restating the step and the next thing to try. The panel then offers the learner a button to practise that skill again in a few days; you don't need to ask. If the learner asks you in words to schedule practice, record request_review.

ERRORS AND CHECKS
- When the learner asks you to explain an error: say what it means and where to look (the line, the API, the docs). Do not write the fix.
- When the learner asks you to suggest a fix: propose the smallest change that fixes the error, as a unified diff of the cell, with one sentence on why. If the fix would amount to solving the exercise, help in GUIDE mode for that step instead.

COURSE RULES YOU KEEP
- Hints are goals, not code, unless the mode allows code for that step.
- Research checkpoints need evidence from primary sources (official docs, API reference, source code, release notes). Point to sources and check the learner's evidence; never write the answer.
- Never print, repeat or ask for API keys or other secrets, even if they appear in the notebook or its output.
- Do not invent APIs. If you are not sure a function or parameter exists in the version the course uses, say so and point to the docs.
- The reference solution, when given, is confidential: use it to know where the learner is heading, and never quote it unless the step is unlocked and the mode is SHOW.

MEMORY
- Record with remember, in the same response, whenever you learn something lasting about the learner:
  - they say how they like to learn ("I prefer an example before the explanation", "shorter answers please"): a preference;
  - a detour showed a gap ("forgot if/else syntax"): a struggle, with the skill;
  - they hold a wrong idea about how something works: a misconception;
  - they handle something easily: a strength.
  Do not record one-off slips such as a typo.
- Use what you remember: adapt your tone, pace and examples to it.

STYLE
- Reply in the language the learner's turn names ("[Reply in Spanish.]"), even if earlier messages were in another language. Keep code, API names and technical terms in English.
- Default voice: a patient senior engineer. Concise, precise, explains the why, no filler, no emoji. Adjust to what you remember about this learner.
- Short answers in Markdown. One step, one idea at a time. End with what the learner should try next.

RESPONSE
Answer with one JSON object: "actions", what you record about this turn (possibly none), then "reply", what the learner reads. The actions:
${ACTIONS_GUIDE}

Example of the JSON shape (the content is only an illustration):
{"actions": [{"tool": "set_steps", "objective": "Read a setting from the environment", "steps": ["Import os", "Read the variable with os.environ.get", "Check that it is set with if/else", "Print a message in each branch"]}, {"tool": "mark_step", "step": 3, "status": "stuck"}, {"tool": "give_hint", "step": 3, "level": 1}], "reply": "The cell asks you to …"}`;

export type NotebookCell = { type: "code" | "markdown"; source: string; output?: string };

export type TurnContext = {
  course: { title: string; modules: { position: number; title: string; lessons: { code: string | null; title: string; completed: boolean; current: boolean }[] }[] } | null;
  lesson: { code: string | null; title: string; objectives: string[]; prerequisites: string | null } | null;
  notebookPath: string;
  cells: NotebookCell[];
  activeCell: number;
  solution?: string;
  mode: TutorMode;
  state: TutorState;
  memory: { kind: string; subject: string; fact: string }[];
  platformLanguage: "es" | "en";
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text);

/** The notebook as the tutor sees it: the active cell and its output in full, the cells near it, and the rest short. */
function notebookView(cells: NotebookCell[], active: number): string {
  return cells
    .map((cell, index) => {
      const distance = Math.abs(index - active);
      const marker = index === active ? " ← ACTIVE CELL" : "";
      // The learner's 💡 hints and official reading are always whole: they are the course's own help.
      const courseHelp = cell.type === "markdown" && /💡|📚|Learning objectives|Exercises/.test(cell.source);
      const limit = index === active ? 6000 : courseHelp || distance <= 2 ? 2500 : 400;
      const output = cell.output ? `\n[output]\n${clip(cell.output, index === active ? 4000 : 600)}` : "";
      return `### Cell ${index + 1} (${cell.type})${marker}\n${clip(cell.source, limit)}${output}`;
    })
    .join("\n\n");
}

export function buildContext(context: TurnContext): string {
  const parts: string[] = [];
  if (context.course) {
    const map = context.course.modules
      .map((courseModule) => {
        const lessons = courseModule.lessons
          .map((lesson) => `  - ${lesson.current ? "▶ " : ""}${lesson.code ?? ""} ${lesson.title}${lesson.completed ? " (completed)" : ""}`)
          .join("\n");
        return `- Module ${String(courseModule.position).padStart(2, "0")}: ${courseModule.title}\n${lessons}`;
      })
      .join("\n");
    parts.push(`# Course: ${context.course.title}\n${map}`);
  }
  if (context.lesson) {
    parts.push(
      `# Current lesson: ${context.lesson.code ?? ""} ${context.lesson.title}\nObjectives:\n${context.lesson.objectives.map((objective, index) => `${index + 1}. ${objective}`).join("\n") || "(none listed)"}\nPrerequisites: ${context.lesson.prerequisites ?? "(none listed)"}`,
    );
  }
  parts.push(`# Notebook: ${context.notebookPath}\n${notebookView(context.cells, context.activeCell)}`);
  if (context.solution) parts.push(`# Reference solution (CONFIDENTIAL)\n${clip(context.solution, 12000)}`);

  const { state } = context;
  const steps = state.steps.length
    ? state.steps.map((step, index) => `${index + 1}. [${step.status}] ${step.text} (hints given: ${state.hints[String(index + 1)] ?? 0})`).join("\n")
    : "(not decomposed yet)";
  const detours = state.detours.length
    ? state.detours.map((detour) => `- ${detour.skill}: ${detour.stage}${detour.challenge ? ` (challenge: ${detour.challenge}; tries: ${detour.tries})` : ""}`).join("\n")
    : "(none)";
  const unlocked = unlockedSteps(state);
  // Show me is earned per step: the harness, not the model, decides where it applies.
  const mode =
    context.mode === "GUIDE"
      ? "GUIDE"
      : unlocked.length
        ? `SHOW only for steps ${unlocked.join(", ")}; GUIDE for every other step`
        : "GUIDE. The learner chose Show me, but it is not unlocked for any step yet: guide them, never show the step's code, and say in one sentence that Show me opens for a step once its three guided hints have been given";
  parts.push(
    `# Session\nMODE: ${mode}\nObjective: ${state.objective ?? "(not set)"}\nMicro-steps:\n${steps}\nShow me unlocked for steps: ${unlocked.length ? unlocked.join(", ") : "none"}\nDetours in progress (innermost last):\n${detours}`,
  );
  parts.push(
    `# What you remember about this learner\n${context.memory.length ? context.memory.map((fact) => `- (${fact.kind.toLowerCase()}) ${fact.subject}: ${fact.fact}`).join("\n") : "(nothing yet)"}\nPlatform language: ${context.platformLanguage === "es" ? "Spanish" : "English"}`,
  );
  return parts.join("\n\n");
}

const SPANISH = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|que|qué|por|para|cómo|como|no|sí|mi|me|un|una|es|está|esto|este|paso|código|ayuda|ayúdame|muéstrame|explica|explícame|puedes|quiero|tengo|error)\b/gi;
const ENGLISH = /\b(the|what|how|why|please|show|code|step|is|my|me|can|you|this|that|help|want|have|explain|error|it|do|does)\b/gi;

/**
 * The language to reply in, decided here rather than by the model: lighter models follow the conversation's
 * earlier language over an instruction to match the latest message. A learner's words decide; a button press,
 * or words too short to tell, fall back to the platform language.
 */
export function replyLanguage(message: string | undefined, platformLanguage: "es" | "en"): "es" | "en" {
  const text = message ?? "";
  const es = text.match(SPANISH)?.length ?? 0;
  const en = text.match(ENGLISH)?.length ?? 0;
  if (es === en) return platformLanguage;
  return es > en ? "es" : "en";
}

export function learnerTurn(kind: "ask" | "explain_error" | "suggest_fix", message: string | undefined, platformLanguage: "es" | "en" = "es"): string {
  const reply = replyLanguage(kind === "ask" ? message : undefined, platformLanguage) === "es" ? "Spanish" : "English";
  if (kind === "explain_error") return `[The learner pressed "Explain this error" on the active cell.]${message ? `\n${message}` : ""}\n\n[Reply in ${reply}.]`;
  if (kind === "suggest_fix") return `[The learner pressed "Suggest a fix" on the active cell.]${message ? `\n${message}` : ""}\n\n[Reply in ${reply}.]`;
  return `${message ?? ""}\n\n[Reply in ${reply}.]`;
}
