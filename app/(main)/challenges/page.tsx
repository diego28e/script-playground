import { ChallengeCard } from "@/components/challenges/challenge-card";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

export const metadata: Metadata = {
    title: "Challenges - Script Playground",
    description: "Browse and solve coding challenges.",
};

export default async function ChallengesPage() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    console.log("[CHALLENGES PAGE] Session user:", session?.user);
    console.log("[CHALLENGES PAGE] User role:", session?.user?.role);
    console.log("[CHALLENGES PAGE] Role type:", typeof session?.user?.role);

    const challenges = await prisma.challenge.findMany({
        orderBy: {
            order: "asc",
        },
        include: {
            labels: true,
        },
    });

    const isAdmin = session?.user?.role === "ADMIN";
    console.log("[CHALLENGES PAGE] Is admin:", isAdmin);

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-8 flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                        Challenges
                    </h1>
                    <p className="text-lg text-zinc-600 dark:text-zinc-400">
                        Select a challenge to start coding.
                    </p>
                </div>
                {isAdmin && (
                    <Link
                        href="/admin/challenges"
                        className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                        <Plus className="h-4 w-4" />
                        Manage Challenges
                    </Link>
                )}
            </div>

            {challenges.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                        No challenges found
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Check back later for new challenges.
                    </p>
                </div>
            ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {challenges.map((challenge) => (
                        <ChallengeCard key={challenge.id} challenge={challenge} />
                    ))}
                </div>
            )}
        </div>
    );
}
