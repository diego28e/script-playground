import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// .env.local wins over .env, as it does for Next.js: it points development at the local database
// (see .env.local.example). dotenv never overrides a variable that is already set.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
