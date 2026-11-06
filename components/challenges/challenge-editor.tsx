"use client";

import { Editor } from "@monaco-editor/react";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
    AlignLeft,
    LogIn,
} from "lucide-react";
import { createSubmission, getUserSubmissions } from "@/actions/submissions";
import { generateAIResponse } from "@/actions/ai";
import { defineAcademiaTheme } from "@/lib/monaco-theme";
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
import { DotLoader } from "@/components/ui/dot-loader";

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
    const [aiError, setAiError] = useState<string | null>(null);
    // AI calls need a signed-in user (they are billed and traced per person). The menu checks up front;
    // this covers a session that expired while the page was open.
    const [aiNeedsSignIn, setAiNeedsSignIn] = useState(false);
    const { data: session, isPending: sessionPending } = authClient.useSession();
    const pathname = usePathname();
    const signInHref = `/login?next=${encodeURIComponent(pathname)}`;
    const [userQuestion, setUserQuestion] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

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

    const handleFormat = () => {
        const formatted = formatCode(code);
        if (formatted !== code) {
            setCode(formatted);
            toast.success("Code formatted");
        } else {
            toast.info("Code already formatted");
        }
    };

    // Runs synchronously and also returns what it showed, so Submit saves this run's result
    // rather than state that has not re-rendered yet.
    const handleRun = (isAutoRun = false, codeOverride?: string): { output: string[]; error: string | null } => {
        setIsRunning(true);
        setOutput([]);
        setError(null);
        setHasRun(true);
        setHasSubmittedCurrentRun(false);

        const codeToRun = codeOverride || code;

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

        let result: { output: string[]; error: string | null };
        try {
            const func = new Function(codeToRun);
            func();
            result = { output: logs.length > 0 ? logs : ["Code executed successfully"], error: null };
            setOutput(result.output);
            setLastRunSuccess(true);
        } catch (err: any) {
            result = { output: logs, error: err.message || "An error occurred" };
            setError(result.error);
            setLastRunSuccess(false);
        } finally {
            console.log = originalConsole.log;
            console.error = originalConsole.error;
            console.warn = originalConsole.warn;
            setIsRunning(false);
        }
        return result;
    };

    const handleSubmit = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        // Format, run and save the same code, and save the result of that run.
        const formatted = formatCode(code);
        if (formatted !== code) {
            setCode(formatted);
        }
        const run = handleRun(false, formatted);
        setHasSubmittedCurrentRun(true);
        const status = run.error ? "FAILED" : "PASSED";

        try {
            const result = await createSubmission({
                challengeId,
                code: formatted,
                status,
                output: run.output.join("\n"),
                error: run.error || undefined,
            });

            if (!result.success) {
                toast.error(result.error === "Unauthorized" ? "Sign in to submit your solution" : "We couldn't save your solution. Try again.");
                setHasSubmittedCurrentRun(false);
            } else if (status === "PASSED") {
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
                toast.info("Submission saved. Fix the error and submit again.");
            }
        } catch {
            toast.error("We couldn't reach the server. Check your connection and try again.");
            setHasSubmittedCurrentRun(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    const { confirm, dialog: confirmDialog } = useConfirm();
    const handleReset = async () => {
        const ok = await confirm({
            title: "Reset to the starter code?",
            description: "Your current code for this challenge is replaced, and it can't be brought back.",
            confirmLabel: "Reset",
            tone: "danger",
        });
        if (ok) {
            setCode(initialCode);
            localStorage.removeItem(`challenge_${challengeId}_code`);
            setOutput([]);
            setError(null);
            setHasRun(false);
            setLastRunSuccess(false);
            toast.success("Code reset to starter");
        }
    };

    const showAiResult = (result: Awaited<ReturnType<typeof generateAIResponse>>) => {
        if (result.success) {
            setAiResponse(result.text);
        } else if (result.reason === "unauthenticated") {
            setAiNeedsSignIn(true);
            setAiError(result.error);
        } else {
            setAiError(`${result.error} (ref ${result.traceId.slice(0, 8)})`);
        }
    };

    const requestExplanation = async () => {
        setIsAiLoading(true);
        setAiError(null);
        setAiNeedsSignIn(false);
        try {
            const result = await generateAIResponse(code, challengeDescription, "explain");
            showAiResult(result);
        } catch {
            setAiError("We couldn't reach the AI service. Check your connection and try again.");
        } finally {
            setIsAiLoading(false);
        }
    };

    const handleAIRequest = (mode: "explain" | "ask") => {
        setAiMode(mode);
        setIsAIDialogOpen(true);
        setAiResponse("");
        setAiError(null);
        if (mode === "explain") {
            void requestExplanation();
        } else {
            // For "ask", we wait for user input in the dialog
            setUserQuestion("");
        }
    };

    const handleAskSubmit = async () => {
        if (!userQuestion.trim() || isAiLoading) return;
        setIsAiLoading(true);
        setAiError(null);
        setAiNeedsSignIn(false);
        try {
            const result = await generateAIResponse(code, challengeDescription, "ask", userQuestion);
            showAiResult(result);
        } catch {
            setAiError("We couldn't reach the AI service. Check your connection and try again.");
        } finally {
            setIsAiLoading(false);
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
            <div role="status" className="flex h-full flex-col items-center justify-center gap-3 bg-code-panel text-code-muted">
                <DotLoader size={28} className="text-code-foreground" />
                <span className="font-mono text-[11px] uppercase tracking-[0.2em]">Loading your code…</span>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {confirmDialog}
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b border-code-border bg-code-panel px-2 py-2 md:px-4 shrink-0">
                <div className="flex items-center gap-2">
                    {!isMobile && (
                        <Tip content={isDescriptionVisible ? "Hide description" : "Show description"}>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onToggleDescription}
                                className="text-code-muted hover:text-code-foreground"
                                aria-label={isDescriptionVisible ? "Hide description" : "Show description"}
                            >
                                {isDescriptionVisible ? (
                                    <ChevronLeft className="h-4 w-4" />
                                ) : (
                                    <ChevronRight className="h-4 w-4" />
                                )}
                            </Button>
                        </Tip>
                    )}
                    <span className="text-xs text-code-muted md:text-sm">script.js</span>
                </div>
                <div className="flex items-center gap-1 md:gap-2">
                    <DropdownMenu>
                        <Tip content="Settings">
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-code-muted hover:text-code-foreground"
                                    aria-label="Settings"
                                >
                                    <Settings className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                        </Tip>
                        <DropdownMenuContent
                            align="end"
                            className="w-56"
                        >
                            <div className="px-2 py-1.5">
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                                    <input
                                        type="checkbox"
                                        checked={autoRun}
                                        onChange={(e) => setAutoRun(e.target.checked)}
                                        className="h-4 w-4 rounded border-input accent-[var(--primary)] focus:ring-2 focus:ring-ring"
                                    />
                                    <span>Auto-run (1.5s delay)</span>
                                </label>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <Tip content={session ? "AI Assistant" : "AI Assistant (sign in to use)"}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-code-muted hover:text-code-foreground"
                                    aria-label="AI Assistant"
                                >
                                    <Sparkles className="h-4 w-4 text-spark" />
                                </Button>
                            </DropdownMenuTrigger>
                        </Tip>
                        <DropdownMenuContent
                            align="end"
                            className="w-56"
                        >
                            {session || sessionPending ? (
                                <>
                                    <DropdownMenuItem
                                        onClick={() => handleAIRequest("explain")}
                                        disabled={sessionPending}
                                    >
                                        <FileCode2 className="mr-2 h-4 w-4" />
                                        <span>Explain line by line</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => handleAIRequest("ask")}
                                        disabled={sessionPending}
                                    >
                                        <MessageSquare className="mr-2 h-4 w-4" />
                                        <span>Ask about the code</span>
                                    </DropdownMenuItem>
                                </>
                            ) : (
                                <>
                                    <p className="px-2 pb-1 pt-1.5 text-xs leading-relaxed text-muted-foreground">
                                        The AI assistant explains your code and answers questions about it. Sign in to use it.
                                    </p>
                                    <DropdownMenuItem asChild>
                                        <Link href={signInHref}>
                                            <LogIn className="mr-2 h-4 w-4" />
                                            <span>Sign in</span>
                                        </Link>
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <Tip content="Reset to starter">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleReset}
                            className="text-code-muted hover:text-code-foreground"
                            aria-label="Reset to starter"
                        >
                            <RotateCcw className="h-4 w-4" />
                        </Button>
                    </Tip>
                    <Tip content="Format code">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleFormat}
                            className="text-code-muted hover:text-code-foreground"
                            aria-label="Format code"
                        >
                            <AlignLeft className="h-4 w-4" />
                        </Button>
                    </Tip>
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
                    {/* Wrapped: the button is disabled until the code has run, and a disabled button gets no hover. */}
                    <Tip
                        wrap
                        content={
                            !hasRun
                                ? "Run code first"
                                : error
                                    ? "Fix errors before submitting"
                                    : "Submit your solution!"
                        }
                    >
                    <Button
                        variant={isSubmitReady ? "default" : "ghost"}
                        size="sm"
                        onClick={handleSubmit}
                        disabled={!hasRun}
                        loading={isSubmitting}
                        className={`
                            transition-all duration-300
                            ${isSubmitReady
                                ? "bg-signal text-signal-foreground shadow-[var(--shadow-tile)] hover:bg-signal-strong" +
                                (isMobile && shouldPulse ? " animate-pulse" : "")
                                : "text-code-muted hover:text-code-foreground opacity-60"
                            }
                        `}
                    >
                        <Send className="h-4 w-4" />
                        <span className="hidden md:inline ml-1">Submit</span>
                    </Button>
                    </Tip>
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
                    beforeMount={defineAcademiaTheme}
                    theme="academia-dark"
                    loading={<DotLoader size={28} className="text-code-foreground" label="Loading editor" />}
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
                className={`border-t border-code-border bg-code-panel shrink-0 transition-all duration-200 ${isMobile ? (isOutputExpanded ? "h-[50vh]" : "h-[140px]") : "h-auto"
                    }`}
            >
                <div className="flex items-center justify-between px-2 py-2 md:px-4 md:py-3">
                    <h3 className="text-xs font-semibold text-code-foreground md:text-sm">
                        Output
                    </h3>
                    {isMobile && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsOutputExpanded(!isOutputExpanded)}
                            className="text-code-muted hover:text-code-foreground h-6 px-2"
                        >
                            <span className="text-xs">
                                {isOutputExpanded ? "Collapse" : "Expand"}
                            </span>
                        </Button>
                    )}
                </div>
                <div
                    className={`overflow-y-auto rounded-md bg-code mx-2 mb-2 p-2 font-mono text-xs md:mx-4 md:mb-4 md:p-3 md:text-sm ${isMobile
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
                            <div key={i} className="text-code-foreground">
                                {line}
                            </div>
                        ))
                    ) : (
                        <div className="text-code-muted">Run your code to see output...</div>
                    )}
                </div>
            </div>

            {/* AI Dialog */}
            <Dialog open={isAIDialogOpen} onOpenChange={setIsAIDialogOpen}>
                <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Bot className="h-5 w-5 text-spark" />
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
                                    disabled={isAiLoading}
                                    className="min-h-[100px]"
                                />
                                <Button
                                    onClick={handleAskSubmit}
                                    disabled={!userQuestion.trim()}
                                    loading={isAiLoading}
                                    loadingLabel="Thinking…"
                                    className="w-full"
                                >
                                    Ask Question
                                </Button>
                            </div>
                        )}

                        {isAiLoading && aiMode === "explain" && (
                            <div role="status" className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
                                <DotLoader size={28} className="text-spark" />
                                <span className="text-sm">Analyzing your code…</span>
                            </div>
                        )}

                        {aiError && !isAiLoading && (
                            <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                                <p className="text-destructive">{aiError}</p>
                                {aiNeedsSignIn ? (
                                    <Button asChild size="sm" className="self-start">
                                        <Link href={signInHref}>
                                            <LogIn className="mr-2 h-4 w-4" />
                                            Sign in
                                        </Link>
                                    </Button>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="self-start"
                                        onClick={() => (aiMode === "explain" ? requestExplanation() : handleAskSubmit())}
                                    >
                                        Try again
                                    </Button>
                                )}
                            </div>
                        )}

                        {aiResponse && (
                            <div className="prose prose-sm dark:prose-invert max-w-none bg-muted/40 p-3 sm:p-4 rounded-lg [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_code]:break-words [&_*]:break-words">
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
