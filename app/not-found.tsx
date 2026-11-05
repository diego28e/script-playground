import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { NotFoundState } from "@/components/feedback/page-states";

// Any URL that matches no route. It renders outside the (main) group, so it brings its own navbar and footer.
export default function NotFound() {
    return (
        <div className="flex min-h-screen flex-col bg-background">
            <Navbar />
            <main className="flex flex-1 flex-col">
                <NotFoundState />
            </main>
            <Footer />
        </div>
    );
}
