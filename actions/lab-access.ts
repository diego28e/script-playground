"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type LabClientResult =
  | { success: true; clientId: string; clientSecret: string; redirectUri: string }
  | { success: false; error: string };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}

/** The OpenID Connect clients registered on the platform; the lab hub's is the only one expected. */
export async function listOAuthClients() {
  if (!(await requireAdmin())) return [];
  return prisma.oauthClient.findMany({
    orderBy: { createdAt: "desc" },
    select: { clientId: true, name: true, redirectUris: true, skipConsent: true, disabled: true, createdAt: true, applicationType: true },
  });
}

/**
 * Registers the lab hub as a trusted client of the platform's sign-in: it may ask for openid, profile and email,
 * sends students back only to `redirectUri`, and skips the consent screen (it is our own app). The secret is
 * shown once; put both values in the hub's .env (OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET).
 * Next.js checks a server action's Origin, so another site cannot trigger this with an admin's cookie.
 */
export async function createLabClient(redirectUri: string): Promise<LabClientResult> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can create the lab client." };
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return { success: false, error: "The redirect URI isn't a valid URL." };
  }
  if (!url.pathname.endsWith("/hub/oauth_callback")) {
    return { success: false, error: "The redirect URI must be the hub's callback, ending in /hub/oauth_callback." };
  }
  // A plain-http callback is only for a lab on this computer; Better Auth allows http only for "native" clients
  // on a loopback host.
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) return { success: false, error: "The redirect URI must use https (or http on localhost)." };

  try {
    const client = await auth.api.adminCreateOAuthClient({
      headers: await headers(),
      body: {
        client_name: local ? "Academia del Código — Laboratorio (local)" : "Academia del Código — Laboratorio",
        redirect_uris: [url.toString()],
        scope: "openid profile email",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        application_type: local ? "native" : "web",
        skip_consent: true,
      },
    });
    revalidatePath("/admin/lab-access");
    if (!client.client_secret) return { success: false, error: "The client was created without a secret." };
    return { success: true, clientId: client.client_id, clientSecret: client.client_secret, redirectUri: url.toString() };
  } catch (error) {
    console.error("Failed to create the lab client:", error);
    return { success: false, error: "We couldn't create the client. Check the server log." };
  }
}
