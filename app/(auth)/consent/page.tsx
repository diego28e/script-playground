import { Metadata } from "next";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ConsentCard } from "@/components/auth/consent-card";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Permitir acceso", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Where the sign-in provider asks a student to approve an app (lib/auth.ts, consentPage). The lab is trusted and
// skips it, so this shows only if a client asks with prompt=consent. The query is signed by the provider; a
// changed or expired one is refused before anything is shown.
export default async function ConsentPage({ searchParams }: Props) {
    const raw = await searchParams;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) for (const item of [value].flat()) if (item !== undefined) params.append(key, item);
    const signedNames = new Set(["sig", "ba_param", ...params.getAll("ba_param")]);
    const query = new URLSearchParams([...params].filter(([key]) => signedNames.has(key)));
    const { secret } = await auth.$context;
    const valid = query.has("sig") && (await verifyOAuthQueryParams(query.toString(), secret));
    const client = valid && query.get("client_id")
        ? await prisma.oauthClient.findFirst({ where: { clientId: query.get("client_id")!, disabled: { not: true } }, select: { name: true } })
        : null;

    return (
        <main className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-muted/40 px-4 py-8">
            <ConsentCard
                valid={Boolean(client)}
                clientName={client?.name ?? null}
                scopes={(query.get("scope") ?? "").split(" ").filter(Boolean)}
                redirectHost={(() => {
                    try {
                        return new URL(query.get("redirect_uri") ?? "").host;
                    } catch {
                        return null;
                    }
                })()}
            />
        </main>
    );
}
