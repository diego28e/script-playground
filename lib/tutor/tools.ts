import { Type, type Schema } from "@google/genai";
import { z } from "zod";

// What the tutor records about each turn. Not function calling: a model that calls functions stops to wait for
// their results, which would cost a second request per turn (the free tier allows 20 a day on the primary model).
// Instead the model answers with one JSON object, the actions it records first and then its reply, enforced by a
// response schema. The harness applies the actions (lib/tutor/state.ts) and refuses those that break the rules.

export const ACTION_TOOLS = [
  "set_steps",
  "mark_step",
  "give_hint",
  "start_detour",
  "detour_challenge",
  "detour_attempt",
  "end_detour",
  "request_review",
  "remember",
] as const;

/** How each action is used, for the system prompt. */
export const ACTIONS_GUIDE = `- set_steps {objective, steps[]}: the current objective as ordered micro-steps, usually 5 to 10, each one action the learner can check. Record it the first time you decompose an objective, and when it changes.
- mark_step {step, status: todo|stuck|done}: where the learner is on a step (steps are numbered from 1).
- give_hint {step, level: 1|2|3}: a guided hint you give in this reply. Levels go up one at a time per step.
- start_detour {skill, reason}: pause the main task to clear a missing prerequisite. At most two deep.
- detour_challenge {task}: the small challenge you give in this reply to prove the prerequisite.
- detour_attempt {}: the learner tried the challenge and did not pass yet.
- end_detour {outcome: passed|skipped}: the learner passed the challenge, or chose to skip it.
- request_review {skill, evidence: passed|skipped}: only when the learner asks in words to practise a skill later.
- remember {kind: preference|misconception|strength|struggle, subject, fact, skill?}: something lasting about this learner; a newer fact on the same subject replaces the old one.`;

/** The response schema: the actions first (plan, then write), then the reply. */
export const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    actions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tool: { type: Type.STRING, enum: [...ACTION_TOOLS] },
          objective: { type: Type.STRING },
          steps: { type: Type.ARRAY, items: { type: Type.STRING } },
          step: { type: Type.INTEGER },
          status: { type: Type.STRING, enum: ["todo", "stuck", "done"] },
          level: { type: Type.INTEGER },
          skill: { type: Type.STRING },
          reason: { type: Type.STRING },
          task: { type: Type.STRING },
          outcome: { type: Type.STRING, enum: ["passed", "skipped"] },
          evidence: { type: Type.STRING, enum: ["passed", "skipped"] },
          kind: { type: Type.STRING, enum: ["preference", "misconception", "strength", "struggle"] },
          subject: { type: Type.STRING },
          fact: { type: Type.STRING },
        },
        required: ["tool"],
        propertyOrdering: ["tool", "objective", "steps", "step", "status", "level", "skill", "reason", "task", "outcome", "evidence", "kind", "subject", "fact"],
      },
    },
    reply: { type: Type.STRING, description: "What the learner reads, in Markdown." },
  },
  required: ["actions", "reply"],
  propertyOrdering: ["actions", "reply"],
};

const ResponseSchema = z.object({
  actions: z.array(z.object({ tool: z.string() }).passthrough()).default([]),
  reply: z.string(),
});

/** Reads the model's JSON; a reply that isn't valid JSON is shown as is, with no actions. */
export function readResponse(text: string): { actions: { tool: string; args: Record<string, unknown> }[]; reply: string } {
  try {
    // Without JSON mode a model may fence its JSON (```json ... ```).
    const parsed = ResponseSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
    return {
      actions: parsed.actions.map(({ tool, ...args }) => ({ tool, args })),
      reply: parsed.reply,
    };
  } catch {
    return { actions: [], reply: text };
  }
}
