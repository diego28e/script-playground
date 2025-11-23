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

            {/* Main Content - 3 Pane Layout Placeholder */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Panel: Description */}
                <div className="w-1/3 overflow-y-auto border-r p-6">
                    <div className="prose dark:prose-invert">
                        <h3>Problem Description</h3>
                        <p className="whitespace-pre-wrap">{challenge.description}</p>
                    </div>
                </div>

                {/* Middle Panel: Code Editor */}
                <div className="flex-1 border-r bg-[#1e1e1e]">
                    <div className="flex h-10 items-center border-b border-zinc-700 bg-[#1e1e1e] px-4 text-sm text-zinc-400">
                        script.js
                    </div>
                    <div className="h-[calc(100%-2.5rem)]">
                        <ChallengeEditor initialCode={challenge.starterCode} />
                    </div>
                </div>

                {/* Right Panel: Output/Console */}
                <div className="w-1/4 bg-zinc-50 p-4 dark:bg-zinc-900">
                    <h3 className="mb-2 font-semibold">Output</h3>
                    <div className="rounded-md border bg-white p-4 font-mono text-sm dark:bg-zinc-950">
                        <span className="text-zinc-400">{"// Output will appear here"}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
