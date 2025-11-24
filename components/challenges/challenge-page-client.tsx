"use client";

import { Badge } from "@/components/ui/badge";
import { ChallengeEditor } from "@/components/challenges/challenge-editor";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";

import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { useState, useRef } from "react";
import { ImperativePanelHandle } from "react-resizable-panels";

interface ChallengePageClientProps {
    challenge: any;
}

export function ChallengePageClient({ challenge }: ChallengePageClientProps) {
    const [isDescriptionVisible, setIsDescriptionVisible] = useState(true);
    const descriptionPanelRef = useRef<ImperativePanelHandle>(null);

    const toggleDescription = () => {
        const panel = descriptionPanelRef.current;
        if (panel) {
            if (isDescriptionVisible) {
                panel.collapse();
            } else {
                panel.expand();
            }
            setIsDescriptionVisible(!isDescriptionVisible);
        }
    };

    return (
        <div className="flex h-[calc(100vh-4rem)] flex-col">
            {/* Header */}
            <div className="border-b bg-zinc-50 px-4 py-3 dark:bg-zinc-900 md:px-6 md:py-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2 md:gap-4">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsDescriptionVisible(!isDescriptionVisible)}
                            className="md:hidden"
                        >
                            {isDescriptionVisible ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                        <h1 className="text-lg font-bold md:text-xl">{challenge.title}</h1>
                        {challenge.completed && (
                            <Badge variant="outline" className="border-green-500 text-green-500 bg-green-500/10 gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Solved
                            </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">{challenge.difficulty}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {challenge.labels.map((label: any) => (
                            <Badge
                                key={label.id}
                                variant="secondary"
                                className="text-xs"
                                style={{ backgroundColor: `${label.color}20`, color: label.color }}
                            >
                                {label.name}
                            </Badge>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Content - Resizable Layout */}
            <div className="relative flex flex-1 overflow-hidden">
                <ResizablePanelGroup direction="horizontal" className="flex-1">
                    {/* Description Panel - Collapsible on mobile, resizable on desktop */}
                    <ResizablePanel
                        ref={descriptionPanelRef}
                        defaultSize={35}
                        minSize={20}
                        maxSize={60}
                        collapsible={true}
                        className="hidden md:block"
                        onCollapse={() => setIsDescriptionVisible(false)}
                        onExpand={() => setIsDescriptionVisible(true)}
                    >
                        <div className="h-full overflow-y-auto bg-white p-6 dark:bg-zinc-950">
                            <div className="prose prose-zinc dark:prose-invert max-w-none">
                                <h2 className="text-2xl font-bold mb-4">Problem Description</h2>
                                <div dangerouslySetInnerHTML={{ __html: challenge.description }} />
                            </div>
                        </div>
                    </ResizablePanel>
                    <ResizableHandle withHandle className="hidden md:flex" />

                    {/* Mobile Description - Full screen overlay */}
                    {isDescriptionVisible && (
                        <div className="absolute inset-0 z-10 bg-white dark:bg-zinc-950 md:hidden">
                            <div className="flex h-full flex-col">
                                <div className="border-b p-4">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsDescriptionVisible(false)}
                                    >
                                        <ChevronLeft className="h-4 w-4 mr-2" />
                                        Back to Code
                                    </Button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4">
                                    <div className="prose prose-zinc dark:prose-invert max-w-none">
                                        <h2 className="text-xl font-bold mb-4">Problem Description</h2>
                                        <div dangerouslySetInnerHTML={{ __html: challenge.description }} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Editor Panel */}
                    <ResizablePanel defaultSize={isDescriptionVisible ? 65 : 100} minSize={40}>
                        <div className="h-full bg-[#1e1e1e]">
                            <ChallengeEditor
                                initialCode={challenge.starterCode}
                                challengeId={challenge.id}
                                isDescriptionVisible={isDescriptionVisible}
                                onToggleDescription={toggleDescription}
                            />
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    );
}
