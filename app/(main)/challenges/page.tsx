import { ChallengeCard } from "@/components/challenges/challenge-card";
import { getChallenges } from "@/actions/challenges";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

export const runtime = 'nodejs';

export const metadata: Metadata = {
    title: "Challenges",
    description: "Browse and solve coding challenges.",
};

export default async function ChallengesPage() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    const challengesResult = await getChallenges(session?.user?.id);
    // A failed query is an error (error.tsx), not an empty list.
    if (!challengesResult.success) throw new Error(challengesResult.error);
    const challenges = challengesResult.data;

    const isAdmin = session?.user?.role === "ADMIN";

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-8 flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Challenges
                    </h1>
                    <p className="text-lg text-muted-foreground">
                        Select a challenge to start coding.
                    </p>
                </div>
                {isAdmin && (
                    <Link
                        href="/admin/challenges"
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-tile)] transition-colors hover:bg-primary/90 md:px-6 md:py-3"
                    >
                        <Plus className="h-4 w-4" />
                        <span className="hidden sm:inline">Manage Challenges</span>
                        <span className="sm:hidden">Manage</span>
                    </Link>
                )}
            </div>

            {!challenges || challenges.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40">
                    <p className="text-lg font-medium text-foreground">
                        No challenges found
                    </p>
                    <p className="text-sm text-muted-foreground">
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
