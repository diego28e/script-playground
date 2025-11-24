import { getChallengeBySlug } from "@/actions/challenges";
import { notFound } from "next/navigation";
import { ChallengePageClient } from "@/components/challenges/challenge-page-client";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const runtime = 'nodejs';

interface ChallengePageProps {
    params: Promise<{
        slug: string;
    }>;
}

export default async function ChallengePage({ params }: ChallengePageProps) {
    const session = await auth.api.getSession({
        headers: await headers(),
    });
    const { slug } = await params;
    const result = await getChallengeBySlug(slug, session?.user?.id);

    if (!result.success || !result.data) {
        notFound();
    }

    const challenge = result.data;

    return <ChallengePageClient challenge={challenge} />;
}
