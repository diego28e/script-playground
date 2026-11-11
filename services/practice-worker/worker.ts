import { logAi } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { recoverOrphans, runWorkerTick, type WorkerState } from "@/lib/practice/jobs";

// The practice worker (docs/practice.md, "Jobs"): carries out the bulk practice work the admin page starts (writing
// every missing task, drafting every remaining lesson), on the lab server beside the grader, with no request time
// limit. It polls the database for the oldest active job, keeps a few of its items in progress, retries what fails
// for a passing reason, and keeps going until the job is done or the admin stops it; the admin page only shows the
// progress. One worker runs at a time.
//
//   pnpm practice-worker:dev     on your PC, against the database in .env.local
//   pnpm practice-worker:build   the bundle for the server (infra/lab/practice-worker)

const TICK_MS = 4_000;
/** On shutdown, how long the items in progress may take to finish (compose gives the container 3 minutes). */
const DRAIN_MS = 170_000;

const state: WorkerState = { inFlight: new Map(), stopping: false };
const log = (level: "info" | "warn" | "error", event: string, entry: Record<string, unknown> = {}) => logAi(level, { event, ...entry });

async function loop() {
  while (!state.stopping) {
    try {
      await runWorkerTick(state);
    } catch (error) {
      // A database blip: log it and try again on the next tick.
      log("error", "practice.worker.tick", { error: error instanceof Error ? error.message : String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}

async function shutdown(signal: string) {
  if (state.stopping) return;
  state.stopping = true;
  log("info", "practice.worker.stopping", { signal, inFlight: state.inFlight.size });
  // Let the items in progress finish (they record their outcome); anything cut off is recovered on the next start.
  await Promise.race([Promise.allSettled([...state.inFlight.values()]), new Promise((resolve) => setTimeout(resolve, DRAIN_MS))]);
  await prisma.$disconnect().catch(() => undefined);
  log("info", "practice.worker.stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Not top-level await: tsx runs the project as CommonJS on a PC (pnpm practice-worker:dev).
async function main() {
  await recoverOrphans();
  log("info", "practice.worker.start", { tickMs: TICK_MS, grader: Boolean(process.env.GRADER_URL), models: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY), deepseek: Boolean(process.env.DEEPSEEK_API_KEY) } });
  await loop();
}

main().catch((error) => {
  log("error", "practice.worker.crashed", { error: error instanceof Error ? error.stack : String(error) });
  // Docker restarts it (restart: unless-stopped); items in progress are recovered on the next start.
  process.exit(1);
});
