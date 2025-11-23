import { getChallengeBySlug } from "@/actions/challenges";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ChallengeEditor } from "@/components/challenges/challenge-editor";

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

    return (
        <div className="flex h-[calc(100vh-4rem)] flex-col">
            {/* Header */}
            <div className="border-b bg-zinc-50 px-6 py-4 dark:bg-zinc-900">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-bold">{challenge.title}</h1>
                        <Badge variant="outline">{challenge.difficulty}</Badge>
                    </div>
                    <div className="flex gap-2">
                        {challenge.labels.map((label) => (
                            <Badge
                                key={label.id}
                                variant="secondary"
                                style={{ backgroundColor: `${label.color}20`, color: label.color }}
                            >
                                {label.name}
                            </Badge>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Content - 2 Pane Layout */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Panel: Description */}
                <div className="w-2/5 overflow-y-auto border-r bg-white p-6 dark:bg-zinc-950">
                    <div className="prose prose-zinc dark:prose-invert max-w-none">
                        <h2 className="text-2xl font-bold mb-4">Problem Description</h2>
                        <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{challenge.description}</p>
                    </div>
                </div>

                {/* Right Panel: Code Editor with integrated output */}
                <div className="flex-1 bg-[#1e1e1e]">
                    <ChallengeEditor initialCode={challenge.starterCode} challengeId={challenge.id} />
                </div>
            </div>
        </div>
    );
}
