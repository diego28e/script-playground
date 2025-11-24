import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

console.log("[Prisma] Module loading");
console.log("[Prisma] DATABASE_URL exists:", !!process.env.DATABASE_URL);

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
    pool: Pool | undefined;
};

console.log("[Prisma] Creating Pool");
const pool = globalForPrisma.pool ?? new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
console.log("[Prisma] Pool created");

console.log("[Prisma] Creating adapter");
const adapter = new PrismaPg(pool);
console.log("[Prisma] Adapter created");

console.log("[Prisma] Creating PrismaClient");
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});
console.log("[Prisma] PrismaClient created");

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
    globalForPrisma.pool = pool;
}
