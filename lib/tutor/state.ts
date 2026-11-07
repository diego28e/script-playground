import { z } from "zod";

// The tutor's state for one notebook conversation (TutorSession.state). The model never edits it directly: it calls
// tools (lib/tutor/tools.ts) and the harness applies them here, so what the tutor "knows" about the session is
// exact, stored, and the same on the next turn.

export const StepStatus = z.enum(["todo", "stuck", "done"]);

const DetourSchema = z.object({
  skill: z.string(),
  reason: z.string(),
  stage: z.enum(["explaining", "challenge"]),
  challenge: z.string().optional(),
  tries: z.number().int().min(0).default(0),
});
export type Detour = z.infer<typeof DetourSchema>;

export const TutorStateSchema = z.object({
  objective: z.string().optional(),
  steps: z.array(z.object({ text: z.string(), status: StepStatus })).default([]),
  // Hint levels given per step (keyed by step number, from 1): 1 goal, 2 pointer, 3 partial.
  hints: z.record(z.string(), z.number().int().min(0).max(3)).default({}),
  // Detours in progress, innermost last.
  detours: z.array(DetourSchema).default([]),
});
export type TutorState = z.infer<typeof TutorStateSchema>;

/** Show me unlocks for a step once its three guided hint levels were given (docs/ai-tutor.md). */
export const SHOW_UNLOCK_LEVEL = 3;
export const MAX_DETOUR_DEPTH = 2;

export function readState(value: unknown): TutorState {
  const parsed = TutorStateSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : TutorStateSchema.parse({});
}

export function unlockedSteps(state: TutorState): number[] {
  return Object.entries(state.hints)
    .filter(([, level]) => level >= SHOW_UNLOCK_LEVEL)
    .map(([step]) => Number(step));
}

/** What the harness did with one tool call, kept with the reply (TutorMessage.actions) and given to the UI. */
export type AppliedAction =
  | {
      tool: string;
      applied: true;
      effect?: {
        practice?: { skill: string; evidence: "PASSED" | "SKIPPED" };
        memory?: MemoryWrite;
        // A detour closed: the panel offers to schedule practice on its skill (one click, no model call).
        ended?: { skill: string; evidence: "PASSED" | "SKIPPED" };
        // The learner asked for more practice on something: the panel offers to schedule it, like a closed detour.
        offered?: { skill: string; evidence: "REQUESTED" };
      };
    }
  | { tool: string; applied: false; refused: string };

export type MemoryWrite = { kind: "PREFERENCE" | "MISCONCEPTION" | "STRENGTH" | "STRUGGLE"; subject: string; fact: string; skill?: string };

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : Number.NaN);

/**
 * Applies one tool call to the state. Returns the new state and what happened; a call that breaks the rules (a
 * hint level skipped, a third nested detour, a step that doesn't exist) is refused, not applied.
 */
export function applyTool(state: TutorState, name: string, args: Record<string, unknown>): { state: TutorState; action: AppliedAction } {
  const refuse = (refused: string) => ({ state, action: { tool: name, applied: false as const, refused } });
  const ok = (next: TutorState, effect?: Extract<AppliedAction, { applied: true }>["effect"]) => ({
    state: next,
    action: { tool: name, applied: true as const, ...(effect ? { effect } : {}) },
  });
  const stepExists = (step: number) => Number.isInteger(step) && step >= 1 && step <= state.steps.length;

  switch (name) {
    case "set_steps": {
      const steps = Array.isArray(args.steps) ? args.steps.map(str).filter(Boolean) : [];
      if (!steps.length) return refuse("no steps");
      const objective = str(args.objective) || state.objective;
      // A new objective starts fresh; the same objective re-planned keeps its hints for the steps that remain.
      const sameObjective = objective === state.objective;
      return ok({
        ...state,
        objective,
        steps: steps.slice(0, 15).map((text) => ({ text, status: "todo" as const })),
        hints: sameObjective ? Object.fromEntries(Object.entries(state.hints).filter(([step]) => Number(step) <= steps.length)) : {},
      });
    }
    case "mark_step": {
      const step = int(args.step);
      const status = StepStatus.safeParse(args.status);
      if (!stepExists(step) || !status.success) return refuse("unknown step or status");
      const steps = state.steps.map((entry, index) => (index + 1 === step ? { ...entry, status: status.data } : entry));
      return ok({ ...state, steps });
    }
    case "give_hint": {
      const step = int(args.step);
      const level = int(args.level);
      if (!stepExists(step)) return refuse("unknown step");
      const given = state.hints[String(step)] ?? 0;
      // One level at a time; repeating a level is fine (the learner asked again).
      if (!(level >= 1 && level <= 3) || level > given + 1) return refuse(`level ${level} after level ${given}`);
      return ok({ ...state, hints: { ...state.hints, [String(step)]: Math.max(given, level) } });
    }
    case "start_detour": {
      const skill = str(args.skill);
      if (!skill) return refuse("no skill");
      if (state.detours.length >= MAX_DETOUR_DEPTH) return refuse(`already ${MAX_DETOUR_DEPTH} detours deep`);
      return ok({ ...state, detours: [...state.detours, { skill, reason: str(args.reason), stage: "explaining", tries: 0 }] });
    }
    case "detour_challenge": {
      const current = state.detours.at(-1);
      if (!current) return refuse("no detour in progress");
      return ok({ ...state, detours: [...state.detours.slice(0, -1), { ...current, stage: "challenge", challenge: str(args.task) }] });
    }
    case "detour_attempt": {
      const current = state.detours.at(-1);
      if (!current || current.stage !== "challenge") return refuse("no challenge in progress");
      return ok({ ...state, detours: [...state.detours.slice(0, -1), { ...current, tries: current.tries + 1 }] });
    }
    case "end_detour": {
      const current = state.detours.at(-1);
      const outcome = args.outcome === "passed" || args.outcome === "skipped" ? args.outcome : null;
      if (!current || !outcome) return refuse("no detour in progress, or no outcome");
      return ok({ ...state, detours: state.detours.slice(0, -1) }, { ended: { skill: current.skill, evidence: outcome === "passed" ? "PASSED" : "SKIPPED" } });
    }
    case "request_review": {
      const skill = str(args.skill);
      const evidence = args.evidence === "skipped" ? "SKIPPED" : "PASSED";
      if (!skill) return refuse("no skill");
      return ok(state, { practice: { skill, evidence } });
    }
    case "offer_practice": {
      const skill = str(args.skill);
      if (!skill) return refuse("no skill");
      return ok(state, { offered: { skill: skill.slice(0, 200), evidence: "REQUESTED" } });
    }
    case "remember": {
      const kind = str(args.kind).toUpperCase();
      const subject = str(args.subject);
      const fact = str(args.fact);
      if (!["PREFERENCE", "MISCONCEPTION", "STRENGTH", "STRUGGLE"].includes(kind) || !subject || !fact) return refuse("kind, subject and fact are needed");
      return ok(state, { memory: { kind: kind as MemoryWrite["kind"], subject: subject.slice(0, 120), fact: fact.slice(0, 500), skill: str(args.skill) || undefined } });
    }
    default:
      return refuse("unknown tool");
  }
}
