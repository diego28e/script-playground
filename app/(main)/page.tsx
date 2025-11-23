import Image from "next/image";
import Link from "next/link";

export default function Home() {
    return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-12 text-center">
            <div className="relative mb-8">
                <div className="absolute -inset-1 opacity-20 blur-xl" />
                <Image
                    src="/logo.png"
                    alt="Script Playground Logo"
                    width={120}
                    height={120}
                    className="relative"
                    priority
                />
            </div>
            <h1 className="max-w-4xl text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-7xl">
                Master Algorithms <br />
                <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
                    through Practice
                </span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
                A modern environment to solve coding challenges, track your progress, and improve your skills.
                No distractions, just code.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                <Link
                    href="/challenges"
                    className="rounded-full bg-zinc-900 px-8 py-3 text-lg font-semibold text-white transition-all hover:scale-105 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                    Start Coding Now
                </Link>
                <Link
                    href="/about"
                    className="rounded-full border border-zinc-200 bg-white px-8 py-3 text-lg font-semibold text-zinc-900 transition-all hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
                >
                    Learn More
                </Link>
            </div>
        </div>
    );
}
