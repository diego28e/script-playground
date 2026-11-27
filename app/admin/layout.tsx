import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";

export const runtime = "nodejs";

// The admin area: the top bar (AdminNav) holds the section links, so the pages get the full width. On phones the pages
// keep 16px from the screen's edges (8px here, 8px of their own).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || session.user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col space-y-6">
      <AdminNav />
      <main className="container mx-auto flex w-full flex-1 flex-col overflow-hidden px-2 sm:px-0">
        {children}
      </main>
    </div>
  );
}
