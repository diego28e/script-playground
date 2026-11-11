// Builds the practice worker (services/practice-worker) into infra/lab/practice-worker/dist/worker.mjs, one file with
// the practice code it uses (lib/practice, lib/ai, ...), plus a copy of the Prisma schema the image generates its client
// from. The database packages stay outside the bundle: the image installs them (infra/lab/practice-worker/package.json).
//
//   pnpm practice-worker:build
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const out = "infra/lab/practice-worker";
mkdirSync(`${out}/dist`, { recursive: true });

await build({
  entryPoints: ["services/practice-worker/worker.ts"],
  outfile: `${out}/dist/worker.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Resolves "@/..." through tsconfig.json's paths.
  tsconfig: "tsconfig.json",
  external: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  // Some bundled packages are CommonJS and call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "none",
  logLevel: "info",
});

copyFileSync("prisma/schema.prisma", `${out}/schema.prisma`);
console.log(`Copied prisma/schema.prisma to ${out}/schema.prisma`);
