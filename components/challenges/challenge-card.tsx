"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Difficulty } from "@prisma/client";
import { CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { LinkPendingFace } from "@/components/ui/pending";

interface ChallengeCardProps {
    challenge: {
        id: string;
        title: string;
        slug: string;
        description: any;
        difficulty: Difficulty;
        completed?: boolean;
        labels: {
            name: string;
            color: string;
        }[];
    };
}

export function ChallengeCard({ challenge }: ChallengeCardProps) {
    const { language } = useLanguage();

    const getDescription = () => {
        let desc = challenge.description;

        if (typeof desc === 'string') {
            try {
                const parsed = JSON.parse(desc);
                if (typeof parsed === 'object' && parsed !== null) {
                    desc = parsed;
                } else {
                    return desc;
                }
            } catch {
                return desc;
            }
        }

        return desc?.[language] || desc?.['en'] || "";
    };

    return (
        <Card className="flex h-full flex-col transition-all hover:border-foreground/25">
            <CardHeader>
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <CardTitle className="line-clamp-1 text-lg break-words">{challenge.title}</CardTitle>
                        {challenge.completed && (
                            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" aria-label="Completed" />
                        )}
                    </div>
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
                    dangerouslySetInnerHTML={{ __html: getDescription() }}
                />
                <div className="mt-4 flex flex-wrap gap-2">
                    {challenge.labels.map((label) => (
                        <span
                            key={label.name}
                            className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground break-all"
                        >
                            {label.name}
                        </span>
                    ))}
                </div>
            </CardContent>
            <CardFooter>
                <Link
                    href={`/challenges/${challenge.slug}`}
                    className="relative inline-flex h-9 w-full items-center justify-center whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-tile)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    <LinkPendingFace>Solve Challenge</LinkPendingFace>
                </Link>
            </CardFooter>
        </Card>
    );
}
