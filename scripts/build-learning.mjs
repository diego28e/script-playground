// Builds the learning service (services/learning) into infra/lab/learning/dist/server.mjs, one file with the tutor
// code it uses (lib/tutor, lib/ai, ...), plus a copy of the Prisma schema the image generates its client from.
// The database packages stay outside the bundle: the image installs them (infra/lab/learning/package.json).
//
//   pnpm learning:build
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const out = "infra/lab/learning";
mkdirSync(`${out}/dist`, { recursive: true });

await build({
  entryPoints: ["services/learning/server.ts"],
  outfile: `${out}/dist/server.mjs`,
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
