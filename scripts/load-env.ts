// Imported first by scripts, so DATABASE_URL is set before lib/prisma reads it.
// .env.local wins over .env, as for Next.js and prisma.config.ts.
import { config } from "dotenv";

config({ path: ".env.local" });
config();
