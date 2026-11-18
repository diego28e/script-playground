import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import type { Viewer } from "@/lib/course-access";

/**
 * The signed-in person of this request, as the course access rule needs them (lib/course-access.ts), or null for a
 * visitor. Read from the session cookie on the server, never from an argument: a page and its metadata share one read.
 */
export const currentViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return null;
  const { id, email, emailVerified, role } = session.user;
  return { id, email, emailVerified, role };
});
