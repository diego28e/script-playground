"use client";

import { Badge } from "@/components/ui/badge";
import { ChallengeEditor } from "@/components/challenges/challenge-editor";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Code2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState, useRef } from "react";
import { ImperativePanelHandle } from "react-resizable-panels";
import { useLanguage } from "@/components/providers/language-provider";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChallengePageClientProps {
  challenge: any;
}

export function ChallengePageClient({ challenge }: ChallengePageClientProps) {
  const [mobileView, setMobileView] = useState<"description" | "code">("code");
  const [isDescriptionVisible, setIsDescriptionVisible] = useState(true);
  const { language, setLanguage } = useLanguage();
  const descriptionPanelRef = useRef<ImperativePanelHandle>(null);

  const getDescription = () => {
    let desc = challenge.description;

    // Handle case where Prisma returns stringified JSON or raw string
    if (typeof desc === "string") {
      try {
        // Try to parse it as JSON first
        const parsed = JSON.parse(desc);
        if (typeof parsed === "object" && parsed !== null) {
          desc = parsed;
        } else {
          // It's just a regular string
          return desc;
        }
      } catch {
        // Not a JSON string, return as is
        return desc;
      }
    }

    const text = desc?.[language];
    if (text) return text;

    return `<div class="p-4 border border-yellow-200 bg-yellow-50 text-yellow-800 rounded-md dark:bg-yellow-900/20 dark:text-yellow-200 dark:border-yellow-800">
            <p class="font-medium">Translation missing</p>
            <p class="text-sm">This challenge has not been translated to ${language === "en" ? "English" : "Spanish"} yet.</p>
        </div>`;
  };

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
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={
                      challenge.prevSlug
                        ? `/challenges/${challenge.prevSlug}`
                        : "#"
                    }
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!challenge.prevSlug}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Previous challenge</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <h1 className="text-lg font-bold md:text-xl">{challenge.title}</h1>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={
                      challenge.nextSlug
                        ? `/challenges/${challenge.nextSlug}`
                        : "#"
                    }
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!challenge.nextSlug}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Next challenge</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {challenge.completed && (
              <Badge
                variant="outline"
                className="border-green-500 text-green-500 bg-green-500/10 gap-1"
              >
                <CheckCircle2 className="h-3 w-3" />
                Solved
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {challenge.difficulty}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {challenge.labels.map((label: any) => (
              <Badge
                key={label.id}
                variant="secondary"
                className="text-xs"
                style={{
                  backgroundColor: `${label.color}20`,
                  color: label.color,
                }}
              >
                {label.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile Tab Navigation */}
      <div className="flex border-b bg-zinc-50 dark:bg-zinc-900 md:hidden">
        <button
          onClick={() => setMobileView("description")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            mobileView === "description"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          Description
        </button>
        <button
          onClick={() => setMobileView("code")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            mobileView === "code"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
          }`}
        >
          <Code2 className="h-4 w-4" />
          Code
        </button>
      </div>

      {/* Mobile View */}
      <div className="flex-1 overflow-hidden md:hidden">
        {mobileView === "description" ? (
          <div
            className="h-full overflow-y-auto bg-white p-4 dark:bg-zinc-950"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="prose prose-zinc dark:prose-invert max-w-none prose-sm">
              <h2 className="text-xl font-bold mb-4">Problem Description</h2>
              <div dangerouslySetInnerHTML={{ __html: getDescription() }} />
            </div>
          </div>
        ) : (
          <ChallengeEditor
            initialCode={challenge.starterCode}
            challengeId={challenge.id}
            isDescriptionVisible={false}
            onToggleDescription={() => setMobileView("description")}
            isMobile={true}
          />
        )}
      </div>

      {/* Desktop View */}
      <div className="hidden flex-1 overflow-hidden md:flex">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel
            ref={descriptionPanelRef}
            defaultSize={35}
            minSize={20}
            maxSize={60}
            collapsible={true}
            onCollapse={() => setIsDescriptionVisible(false)}
            onExpand={() => setIsDescriptionVisible(true)}
          >
            <div className="h-full overflow-y-auto bg-white p-6 dark:bg-zinc-950">
              <div className="prose prose-zinc dark:prose-invert max-w-none">
                <h2 className="text-2xl font-bold mb-4">Problem Description</h2>
                <div dangerouslySetInnerHTML={{ __html: getDescription() }} />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={65} minSize={40}>
            <ChallengeEditor
              initialCode={challenge.starterCode}
              challengeId={challenge.id}
              isDescriptionVisible={isDescriptionVisible}
              onToggleDescription={toggleDescription}
              isMobile={false}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
