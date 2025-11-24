"use client";

import { Editor } from "@monaco-editor/react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
    Play,
    RotateCcw,
    Send,
    Settings,
    Sparkles,
    ChevronLeft,
    ChevronRight,
    Bot,
    FileCode2,
    MessageSquare,
} from "lucide-react";
import { createSubmission, getUserSubmissions } from "@/actions/submissions";
import { generateAIResponse } from "@/actions/ai";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";

interface ChallengeEditorProps {
    initialCode: string;
    challengeId: string;
    isDescriptionVisible: boolean;
    onToggleDescription: () => void;
    isMobile: boolean;
    challengeDescription?: string;
}

export function ChallengeEditor({
    initialCode,
    challengeId,
    isDescriptionVisible,
    onToggleDescription,
    isMobile,
    challengeDescription = "",
}: ChallengeEditorProps) {
    const [isOutputExpanded, setIsOutputExpanded] = useState(false);
    const [code, setCode] = useState(initialCode);
    const [isLoadingSubmission, setIsLoadingSubmission] = useState(true);
    const [hasRun, setHasRun] = useState(false);
    const [lastRunSuccess, setLastRunSuccess] = useState(false);
    const [hasSubmittedCurrentRun, setHasSubmittedCurrentRun] = useState(false);

    // AI State
    const [isAIDialogOpen, setIsAIDialogOpen] = useState(false);
    const [aiMode, setAiMode] = useState<"explain" | "ask">("explain");
    const [aiResponse, setAiResponse] = useState("");
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [userQuestion, setUserQuestion] = useState("");

    useEffect(() => {
        const loadLastAttempt = async () => {
            const localDraft = localStorage.getItem(`challenge_${challengeId}_code`);

            if (localDraft) {
                setCode(localDraft);
                setIsLoadingSubmission(false);
                return;
            }

            const result = await getUserSubmissions(challengeId);
            if (result.success && result.data && result.data.length > 0) {
                setCode(result.data[0].code);
                toast.info("Loaded your last submission");
            }
            setIsLoadingSubmission(false);
        };

        loadLastAttempt();
    }, [challengeId]);
    const [output, setOutput] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [autoRun, setAutoRun] = useState(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("autoRun") === "true";
        }
        return false;
    });
    const autoRunTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        localStorage.setItem("autoRun", String(autoRun));
    }, [autoRun]);

    useEffect(() => {
        const saveTimeout = setTimeout(() => {
            localStorage.setItem(`challenge_${challengeId}_code`, code);
        }, 1000);
        return () => clearTimeout(saveTimeout);
    }, [code, challengeId]);

    useEffect(() => {
        if (autoRun && code !== initialCode) {
            if (autoRunTimeoutRef.current) {
                clearTimeout(autoRunTimeoutRef.current);
            }
            autoRunTimeoutRef.current = setTimeout(() => {
                handleRun(true); // Pass true to indicate auto-run
            }, 1500);
        }
        return () => {
            if (autoRunTimeoutRef.current) {
                clearTimeout(autoRunTimeoutRef.current);
            }
        };
    }, [code, autoRun]);

    const formatCode = (currentCode: string) => {
        try {
            const lines = currentCode.split("\n");
            let formatted = "";
            let indentLevel = 0;
            const indent = "  ";

            for (let line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (
                    trimmed.startsWith("}") ||
                    trimmed.startsWith("]") ||
                    trimmed.startsWith(")")
                ) {
                    indentLevel = Math.max(0, indentLevel - 1);
                }

                formatted += indent.repeat(indentLevel) + trimmed + "\n";

                if (
                    trimmed.endsWith("{") ||
                    trimmed.endsWith("[") ||
                    trimmed.endsWith("(")
                ) {
                    indentLevel++;
                }
                if (
                    (trimmed.startsWith("}") ||
                        trimmed.startsWith("]") ||
                        trimmed.startsWith(")")) &&
                    (trimmed.endsWith("{") || trimmed.endsWith("["))
                ) {
                    indentLevel++;
                }
            }
            return formatted.trim();
        } catch (err) {
            console.error("Format error:", err);
            return currentCode;
        }
    };

    const handleRun = (isAutoRun = false) => {
        setIsRunning(true);
        setOutput([]);
        setError(null);
        setHasRun(true);
        setHasSubmittedCurrentRun(false);

        // Format code logic
        let codeToRun = code;
        // If auto-run is enabled, we format on every run (auto or manual).
        // If auto-run is disabled, we format only on manual run.
        // So effectively, we always format if autoRun is true OR if it's a manual run.
        if (autoRun || !isAutoRun) {
            const formatted = formatCode(code);
            if (formatted !== code) {
                setCode(formatted);
                codeToRun = formatted;
                if (!isAutoRun) {
                    toast.success("Code formatted & executed");
                }
            }
        }

        const logs: string[] = [];
        const originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
        };

        console.log = (...args: any[]) => {
            logs.push(
                args
                    .map((arg) =>
                        typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
                    )
                    .join(" ")
            );
            originalConsole.log(...args);
        };

        console.error = (...args: any[]) => {
            logs.push(`ERROR: ${args.join(" ")}`);
            originalConsole.error(...args);
        };

        console.warn = (...args: any[]) => {
            logs.push(`WARN: ${args.join(" ")}`);
            originalConsole.warn(...args);
        };

        try {
            const func = new Function(codeToRun);
            func();
            setOutput(logs.length > 0 ? logs : ["Code executed successfully"]);
            setLastRunSuccess(true);
        } catch (err: any) {
            setError(err.message || "An error occurred");
            setLastRunSuccess(false);
        } finally {
            console.log = originalConsole.log;
            console.error = originalConsole.error;
            console.warn = originalConsole.warn;
            setIsRunning(false);
        }
    };

    const handleSubmit = async () => {
        handleRun();
        setHasSubmittedCurrentRun(true);

        setTimeout(async () => {
            const status = error ? "FAILED" : "PASSED";
            const result = await createSubmission({
                challengeId,
                code,
                status,
                output: output.join("\n"),
                error: error || undefined,
            });

            if (result.success) {
                if (status === "PASSED") {
                    const audio = new Audio("/sounds/success.mp3");
                    audio.volume = 0.5;
                    audio.play().catch(() => { });

                    confetti({
                        particleCount: 100,
                        spread: 70,
                        origin: { y: 0.6 },
                    });

                    toast.success("🎉 Challenge Passed! Solution submitted!");
                } else {
                    toast.info("Submission saved");
                }
            } else {
                toast.error("Failed to submit solution");
            }
        }, 100);
    };

    const handleReset = () => {
        if (confirm("Reset to starter code? Your current progress will be lost.")) {
            setCode(initialCode);
            localStorage.removeItem(`challenge_${challengeId}_code`);
            setOutput([]);
            setError(null);
            setHasRun(false);
            setLastRunSuccess(false);
            toast.success("Code reset to starter");
        }
    };

    const handleAIRequest = async (mode: "explain" | "ask") => {
        setAiMode(mode);
        setIsAIDialogOpen(true);
        setAiResponse("");

        if (mode === "explain") {
            setIsAiLoading(true);
            const result = await generateAIResponse(code, challengeDescription, "explain");
            setIsAiLoading(false);
            if (result.success && result.text) {
                setAiResponse(result.text);
            } else {
                toast.error(result.error || "Failed to generate explanation");
                setIsAIDialogOpen(false);
            }
        } else {
            // For "ask", we wait for user input in the dialog
            setUserQuestion("");
        }
    };

    const handleAskSubmit = async () => {
        if (!userQuestion.trim()) return;
        setIsAiLoading(true);
        const result = await generateAIResponse(code, challengeDescription, "ask", userQuestion);
        setIsAiLoading(false);
        if (result.success && result.text) {
            setAiResponse(result.text);
        } else {
            toast.error(result.error || "Failed to get answer");
        }
    };


    const submitState = !hasRun
        ? "initial"
        : error
            ? "failed"
            : lastRunSuccess
                ? "success"
                : "initial";
    const isSubmitReady = submitState === "success";
    const shouldPulse = isSubmitReady && !hasSubmittedCurrentRun;

    if (isLoadingSubmission) {
        return (
            <div className="flex h-full items-center justify-center bg-[#1e1e1e]">
                <div className="text-zinc-400">Loading...</div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b border-zinc-700 bg-[#1e1e1e] px-2 py-2 md:px-4 shrink-0">
                <div className="flex items-center gap-2">
                    {!isMobile && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onToggleDescription}
                            className="text-zinc-400 hover:text-zinc-100"
                            title={
                                isDescriptionVisible ? "Hide description" : "Show description"
                            }
                        >
                            {isDescriptionVisible ? (
                                <ChevronLeft className="h-4 w-4" />
                            ) : (
                                <ChevronRight className="h-4 w-4" />
                            )}
                        </Button>
                    )}
                    <span className="text-xs text-zinc-400 md:text-sm">script.js</span>
                </div>
                <div className="flex items-center gap-1 md:gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-zinc-400 hover:text-zinc-100"
                                title="Settings"
                            >
                                <Settings className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="w-56 bg-white dark:bg-zinc-900"
                        >
                            <div className="px-2 py-1.5">
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100">
                                    <input
                                        type="checkbox"
                                        checked={autoRun}
                                        onChange={(e) => setAutoRun(e.target.checked)}
                                        className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-zinc-600"
                                    />
                                    <span>Auto-run (1.5s delay)</span>
                                </label>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-zinc-400 hover:text-zinc-100"
                                title="AI Assistant"
                            >
                                <Sparkles className="h-4 w-4 text-purple-400" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700">
                            <DropdownMenuItem onClick={() => handleAIRequest("explain")} className="text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                                <FileCode2 className="mr-2 h-4 w-4" />
                                <span>Explain line by line</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAIRequest("ask")} className="text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                                <MessageSquare className="mr-2 h-4 w-4" />
                                <span>Ask about the code</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="text-zinc-400 hover:text-zinc-100"
                        title="Reset to starter"
                    >
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRun(false)}
                        disabled={isRunning}
                        className="text-green-400 hover:text-green-300"
                    >
                        <Play className="h-4 w-4" />
                        <span className="hidden sm:inline ml-1">Run</span>
                    </Button>
                    <Button
                        variant={isSubmitReady ? "default" : "ghost"}
                        size="sm"
                        onClick={handleSubmit}
                        disabled={!hasRun}
                        className={`
                            transition-all duration-300
                            ${isSubmitReady
                                ? "bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/50 md:rounded-md" +
                                (isMobile && shouldPulse
                                    ? " rounded-full animate-pulse"
                                    : isMobile
                                        ? " rounded-full"
                                        : "")
                                : "text-zinc-400 hover:text-zinc-100 opacity-60"
                            }
                        `}
                        title={
                            !hasRun
                                ? "Run code first"
                                : error
                                    ? "Fix errors before submitting"
                                    : "Submit your solution!"
                        }
                    >
                        <Send className="h-4 w-4" />
                        <span className="hidden md:inline ml-1">Submit</span>
                    </Button>
                </div>
            </div>
            {/* Editor */}
            <div
                className={
                    isMobile ? "flex-1 min-h-0 overflow-hidden" : "flex-1 min-h-0"
                }
            >
                <Editor
                    height="100%"
                    defaultLanguage="javascript"
                    theme="vs-dark"
                    value={code}
                    onChange={(value) => setCode(value || "")}
                    options={{
                        minimap: { enabled: false },
                        fontSize: isMobile ? 12 : 13,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        wordWrap: "on",
                        wrappingStrategy: "advanced",
                        scrollbar: {
                            vertical: isMobile ? "auto" : "visible",
                            horizontal: "auto",
                        },
                    }}
                />
            </div>

            {/* Output Panel */}
            <div
                className={`border-t border-zinc-700 bg-zinc-900 shrink-0 transition-all duration-200 ${isMobile ? (isOutputExpanded ? "h-[50vh]" : "h-[140px]") : "h-auto"
                    }`}
            >
                <div className="flex items-center justify-between px-2 py-2 md:px-4 md:py-3">
                    <h3 className="text-xs font-semibold text-zinc-300 md:text-sm">
                        Output
                    </h3>
                    {isMobile && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsOutputExpanded(!isOutputExpanded)}
                            className="text-zinc-400 hover:text-zinc-100 h-6 px-2"
                        >
                            <span className="text-xs">
                                {isOutputExpanded ? "Collapse" : "Expand"}
                            </span>
                        </Button>
                    )}
                </div>
                <div
                    className={`overflow-y-auto rounded-md bg-zinc-950 mx-2 mb-2 p-2 font-mono text-xs md:mx-4 md:mb-4 md:p-3 md:text-sm ${isMobile
                            ? isOutputExpanded
                                ? "h-[calc(50vh-60px)]"
                                : "h-[90px]"
                            : "max-h-32"
                        }`}
                    style={{ WebkitOverflowScrolling: "touch" }}
                >
                    {error ? (
                        <div className="text-red-400">
                            <span className="font-semibold">Error:</span> {error}
                        </div>
                    ) : output.length > 0 ? (
                        output.map((line, i) => (
                            <div key={i} className="text-zinc-300">
                                {line}
                            </div>
                        ))
                    ) : (
                        <div className="text-zinc-500">Run your code to see output...</div>
                    )}
                </div>
            </div>

            {/* AI Dialog */}
            <Dialog open={isAIDialogOpen} onOpenChange={setIsAIDialogOpen}>
                <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Bot className="h-5 w-5 text-purple-500" />
                            {aiMode === "explain" ? "Code Explanation" : "Ask AI"}
                        </DialogTitle>
                        <DialogDescription>
                            {aiMode === "explain"
                                ? "Here is a line-by-line explanation of your code."
                                : "Ask a question about your code."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="mt-4 space-y-4">
                        {aiMode === "ask" && !aiResponse && (
                            <div className="space-y-2">
                                <Textarea
                                    placeholder="What does this function do?"
                                    value={userQuestion}
                                    onChange={(e) => setUserQuestion(e.target.value)}
                                    className="min-h-[100px]"
                                />
                                <Button
                                    onClick={handleAskSubmit}
                                    disabled={isAiLoading || !userQuestion.trim()}
                                    className="w-full"
                                >
                                    {isAiLoading ? "Thinking..." : "Ask Question"}
                                </Button>
                            </div>
                        )}

                        {isAiLoading && aiMode === "explain" && (
                            <div className="flex items-center justify-center py-8 text-zinc-500">
                                <Sparkles className="h-6 w-6 animate-spin mr-2" />
                                Analyzing code...
                            </div>
                        )}

                        {aiResponse && (
                            <div className="prose prose-sm dark:prose-invert max-w-none bg-zinc-50/50 dark:bg-zinc-900/50 p-4 rounded-lg">
                                <ReactMarkdown>{aiResponse}</ReactMarkdown>
                            </div>
                        )}

                        {aiResponse && aiMode === "ask" && (
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setAiResponse("");
                                    setUserQuestion("");
                                }}
                                className="w-full mt-2"
                            >
                                Ask Another Question
                            </Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
