import { listOAuthClients } from "@/actions/lab-access";
import { LabAccessPanel } from "@/components/admin/lab-access-panel";

export const runtime = "nodejs";

export default async function LabAccessPage() {
    const clients = await listOAuthClients();

    return (
        <div className="h-full flex-1 flex-col space-y-8 p-8 md:flex">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Lab access</h2>
                <p className="max-w-2xl text-muted-foreground">
                    Students sign in to the lab with their platform account. The lab admits everyone enrolled in a
                    published course, and platform admins as lab admins.
                </p>
            </div>

            <LabAccessPanel />

            <div className="space-y-3">
                <h3 className="font-semibold">Registered clients</h3>
                {clients.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        No clients yet. Create the lab client above.
                    </p>
                ) : (
                    <ul className="divide-y divide-border rounded-xl border border-border">
                        {clients.map((client) => (
                            <li key={client.clientId} className="flex flex-col gap-1 p-4 text-sm">
                                <span className="font-medium">
                                    {client.name ?? "Unnamed client"}
                                    {client.disabled && <span className="ml-2 text-xs text-destructive">disabled</span>}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground">client_id {client.clientId}</span>
                                <span className="font-mono text-xs text-muted-foreground">{client.redirectUris.join(", ")}</span>
                                <span className="text-xs text-muted-foreground">
                                    {client.skipConsent ? "Trusted (no consent screen)" : "Asks for consent"} · created{" "}
                                    {client.createdAt?.toISOString().slice(0, 10) ?? "—"}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
