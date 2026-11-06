import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

// Supabase requires TLS; the local development database (infra/dev) has none. host.docker.internal is that same
// local database seen from a container (the learning service run in the local lab).
const isLocalDatabase = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(process.env.DATABASE_URL ?? "");

const pool =
  globalForPrisma.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  });

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pool = pool;
}
