import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";

export default function MainLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
            <Navbar />
            <main className="flex flex-1 flex-col">{children}</main>
            <Footer />
        </div>
    );
}
