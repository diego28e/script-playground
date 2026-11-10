// Loads Python Compass's concepts from the course inventory into the database (docs/compass.md). Run it after
// `npx prisma migrate deploy` adds the compass tables, and again after scripts/compass-inventory.py regenerates the
// inventory. Uses the database in .env.local (local) or .env (production), like the other scripts.
//
//   npx tsx scripts/compass-sync.ts
import "./load-env";
import { prisma } from "@/lib/prisma";
import { syncConcepts } from "@/lib/compass/concepts";

syncConcepts()
  .then(({ concepts, commit }) => console.log(`${concepts} concepts loaded (course inventory at ${commit.slice(0, 12)}).`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
