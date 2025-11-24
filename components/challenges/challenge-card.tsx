import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Difficulty } from "@prisma/client";

interface ChallengeCardProps {
    challenge: {
        id: string;
        title: string;
        slug: string;
        description: string;
        difficulty: Difficulty;
        labels: {
            name: string;
            color: string;
        }[];
    };
}

export function ChallengeCard({ challenge }: ChallengeCardProps) {
    return (
        <Card className="flex h-full flex-col transition-all hover:border-zinc-400 dark:hover:border-zinc-700">
            <CardHeader>
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-1 text-lg break-words min-w-0">{challenge.title}</CardTitle>
                    <Badge
                        variant={
                            challenge.difficulty === "EASY"
                                ? "secondary"
                                : challenge.difficulty === "MEDIUM"
                                    ? "default"
                                    : "destructive"
                        }
                        className={
                            challenge.difficulty === "EASY"
                                ? "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 shrink-0"
                                : challenge.difficulty === "MEDIUM"
                                    ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400 shrink-0"
                                    : "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 shrink-0"
                        }
                    >
                        {challenge.difficulty}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="flex-1">
                <div 
                    className="line-clamp-3 text-sm text-muted-foreground break-words overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: challenge.description }}
                />
                <div className="mt-4 flex flex-wrap gap-2">
                    {challenge.labels.map((label) => (
                        <span
                            key={label.name}
                            className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 break-all"
                        >
                            {label.name}
                        </span>
                    ))}
                </div>
            </CardContent>
            <CardFooter>
                <Link href={`/challenges/${challenge.slug}`} className="w-full">
                    <div className="inline-flex h-9 w-full items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow transition-colors hover:bg-zinc-900/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90 dark:focus-visible:ring-zinc-300">
                        Solve Challenge
                    </div>
                </Link>
            </CardFooter>
        </Card>
    );
}
