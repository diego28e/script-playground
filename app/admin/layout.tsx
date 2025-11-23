import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    console.log("[ADMIN LAYOUT] Session:", JSON.stringify(session, null, 2));
    console.log("[ADMIN LAYOUT] User role:", session?.user?.role);
    console.log("[ADMIN LAYOUT] Role type:", typeof session?.user?.role);
    console.log("[ADMIN LAYOUT] Role check (=== 'ADMIN'):", session?.user?.role === "ADMIN");
    console.log("[ADMIN LAYOUT] Role check (=== 'admin'):", session?.user?.role === "admin");

    if (!session || session.user.role !== "ADMIN") {
        console.log("[ADMIN LAYOUT] Access denied, redirecting to /");
        redirect("/");
    }

    console.log("[ADMIN LAYOUT] Access granted");

    return (
        <div className="flex min-h-screen flex-col space-y-6">
            <AdminNav />
            <div className="container grid flex-1 gap-12 md:grid-cols-[200px_1fr] lg:grid-cols-[240px_1fr]">
                <aside className="hidden w-[200px] flex-col md:flex lg:w-[240px]">
                    <nav className="grid items-start gap-2">
                        <div className="px-2 py-2">
                            <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">
                                Collections
                            </h2>
                            <div className="space-y-1">
                                <Link href="/admin/challenges" className="block rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">Challenges</Link>
                            </div>
                        </div>
                    </nav>
                </aside>
                <main className="flex w-full flex-1 flex-col overflow-hidden">
                    {children}
                </main>
            </div>
        </div>
    );
}
