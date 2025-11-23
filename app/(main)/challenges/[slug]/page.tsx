import { getChallengeBySlug } from "@/actions/challenges";
import { notFound } from "next/navigation";
import { ChallengePageClient } from "@/components/challenges/challenge-page-client";

interface ChallengePageProps {
    params: Promise<{
        slug: string;
    }>;
}

export default async function ChallengePage({ params }: ChallengePageProps) {
    const { slug } = await params;
    const result = await getChallengeBySlug(slug);

    if (!result.success || !result.data) {
        notFound();
    }

    const challenge = result.data;

    return <ChallengePageClient challenge={challenge} />;
}
