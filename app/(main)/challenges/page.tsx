import { ChallengeCard } from "@/components/challenges/challenge-card";
import { prisma } from "@/lib/prisma";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Challenges - Script Playground",
    description: "Browse and solve coding challenges.",
};

export default async function ChallengesPage() {
    const challenges = await prisma.challenge.findMany({
        orderBy: {
            order: "asc",
        },
        include: {
            labels: true,
        },
    });

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-8 flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Challenges
                </h1>
                <p className="text-lg text-zinc-600 dark:text-zinc-400">
                    Select a challenge to start coding.
                </p>
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
