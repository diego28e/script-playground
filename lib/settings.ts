import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Platform-wide settings an admin changes from the dashboard (the `platform_setting` table: one row per key, its value
// as JSON). Read by the platform and by the lab's services, which keep a value for a minute: a change made in the
// dashboard reaches a running service within that time, with no restart.

const KEEP_MS = 60_000;
const kept = new Map<string, { at: number; value: unknown }>();

/**
 * A setting's stored value, or undefined when it was never set. Never throws: if the table can't be read (the database
 * is away, or a deploy is ahead of its migration), the caller gets undefined and uses its default.
 */
export async function readSetting(key: string): Promise<unknown> {
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key }, select: { value: true } });
    const value = row?.value ?? undefined;
    kept.set(key, { at: Date.now(), value });
    return value;
  } catch {
    // Kept for the minute too, so a table that can't be read isn't asked again on every reply.
    kept.set(key, { at: Date.now(), value: hit?.value });
    return hit?.value;
  }
}

export async function writeSetting(key: string, value: Prisma.InputJsonValue, userId: string): Promise<void> {
  await prisma.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: userId }, update: { value, updatedById: userId } });
  kept.set(key, { at: Date.now(), value });
}
