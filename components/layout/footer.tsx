export function Footer() {
    return (
        <footer className="border-t border-zinc-200 bg-white py-8 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="container mx-auto px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                &copy; {new Date().getFullYear()} Script Playground. All rights reserved.
            </div>
        </footer>
    );
}
