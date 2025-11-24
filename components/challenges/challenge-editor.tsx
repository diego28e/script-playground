"use client";

import { Editor } from "@monaco-editor/react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, Send, Settings, Wand2, ChevronLeft, ChevronRight } from "lucide-react";
import { createSubmission, getUserSubmissions } from "@/actions/submissions";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChallengeEditorProps {
    initialCode: string;
    challengeId: string;
    isDescriptionVisible: boolean;
    onToggleDescription: () => void;
    isMobile: boolean;
}

export function ChallengeEditor({ initialCode, challengeId, isDescriptionVisible, onToggleDescription, isMobile }: ChallengeEditorProps) {
    const [isOutputExpanded, setIsOutputExpanded] = useState(false);
    const [code, setCode] = useState(initialCode);
    const [isLoadingSubmission, setIsLoadingSubmission] = useState(true);
    const [hasRun, setHasRun] = useState(false);
    const [lastRunSuccess, setLastRunSuccess] = useState(false);
    const [hasSubmittedCurrentRun, setHasSubmittedCurrentRun] = useState(false);

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
                toast.info('Loaded your last submission');
            }
            setIsLoadingSubmission(false);
        };

        loadLastAttempt();
    }, [challengeId]);
    const [output, setOutput] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [autoRun, setAutoRun] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('autoRun') === 'true';
        }
        return false;
    });
    const autoRunTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        localStorage.setItem('autoRun', String(autoRun));
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
                handleRun();
            }, 1500);
        }
        return () => {
            if (autoRunTimeoutRef.current) {
                clearTimeout(autoRunTimeoutRef.current);
            }
        };
    }, [code, autoRun]);

    const handleRun = () => {
        setIsRunning(true);
        setOutput([]);
        setError(null);
        setHasRun(true);
        setHasSubmittedCurrentRun(false);

        const logs: string[] = [];
        const originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
        };

        console.log = (...args: any[]) => {
            logs.push(args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' '));
            originalConsole.log(...args);
        };

        console.error = (...args: any[]) => {
            logs.push(`ERROR: ${args.join(' ')}`);
            originalConsole.error(...args);
        };

        console.warn = (...args: any[]) => {
            logs.push(`WARN: ${args.join(' ')}`);
            originalConsole.warn(...args);
        };

        try {
            const func = new Function(code);
            func();
            setOutput(logs.length > 0 ? logs : ['Code executed successfully']);
            setLastRunSuccess(true);
        } catch (err: any) {
            setError(err.message || 'An error occurred');
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
            const status = error ? 'FAILED' : 'PASSED';
            const result = await createSubmission({
                challengeId,
                code,
                status,
                output: output.join('\n'),
                error: error || undefined,
            });

            if (result.success) {
                if (status === 'PASSED') {
                    const audio = new Audio('/sounds/success.mp3');
                    audio.volume = 0.5;
                    audio.play().catch(() => {});
                    
                    confetti({
                        particleCount: 100,
                        spread: 70,
                        origin: { y: 0.6 }
                    });
                    
                    toast.success('🎉 Challenge Passed! Solution submitted!');
                } else {
                    toast.info('Submission saved');
                }
            } else {
                toast.error('Failed to submit solution');
            }
        }, 100);
    };

    const handleReset = () => {
        if (confirm('Reset to starter code? Your current progress will be lost.')) {
            setCode(initialCode);
            localStorage.removeItem(`challenge_${challengeId}_code`);
            setOutput([]);
            setError(null);
            setHasRun(false);
            setLastRunSuccess(false);
            toast.success('Code reset to starter');
        }
    };

    const handleFormat = async () => {
        try {
            const prettier = await import('prettier/standalone');
            const parserBabel = await import('prettier/plugins/babel');
            const parserEstree = await import('prettier/plugins/estree');
            
            const formatted = await prettier.format(code, {
                parser: 'babel',
                plugins: [parserBabel.default, parserEstree.default],
                semi: true,
                singleQuote: true,
                tabWidth: 2,
            });
            setCode(formatted);
            toast.success('Code formatted');
        } catch (err) {
            toast.error('Failed to format code');
        }
    };

    const submitState = !hasRun ? 'initial' : error ? 'failed' : lastRunSuccess ? 'success' : 'initial';
    const isSubmitReady = submitState === 'success';
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
                            title={isDescriptionVisible ? "Hide description" : "Show description"}
                        >
                            {isDescriptionVisible ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
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
                        <DropdownMenuContent align="end" className="w-56 bg-white dark:bg-zinc-900">
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
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleFormat}
                        className="text-zinc-400 hover:text-zinc-100"
                        title="Format code"
                    >
                        <Wand2 className="h-4 w-4" />
                    </Button>
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
                        onClick={handleRun}
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
                                ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/50 md:rounded-md' + (isMobile && shouldPulse ? ' rounded-full animate-pulse' : isMobile ? ' rounded-full' : '')
                                : 'text-zinc-400 hover:text-zinc-100 opacity-60'
                            }
                        `}
                        title={!hasRun ? 'Run code first' : error ? 'Fix errors before submitting' : 'Submit your solution!'}
                    >
                        <Send className="h-4 w-4" />
                        <span className="hidden md:inline ml-1">Submit</span>
                    </Button>
                </div>
            </div>
            {/* Editor */}
            <div className={isMobile ? "flex-1 min-h-0 overflow-hidden" : "flex-1 min-h-0"}>
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
                            vertical: isMobile ? 'auto' : 'visible',
                            horizontal: 'auto',
                        },
                    }}
                />
            </div>

            {/* Output Panel */}
            <div 
                className={`border-t border-zinc-700 bg-zinc-900 shrink-0 transition-all duration-200 ${
                    isMobile 
                        ? isOutputExpanded ? 'h-[50vh]' : 'h-[140px]'
                        : 'h-auto'
                }`}
            >
                <div className="flex items-center justify-between px-2 py-2 md:px-4 md:py-3">
                    <h3 className="text-xs font-semibold text-zinc-300 md:text-sm">Output</h3>
                    {isMobile && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsOutputExpanded(!isOutputExpanded)}
                            className="text-zinc-400 hover:text-zinc-100 h-6 px-2"
                        >
                            <span className="text-xs">{isOutputExpanded ? 'Collapse' : 'Expand'}</span>
                        </Button>
                    )}
                </div>
                <div 
                    className={`overflow-y-auto rounded-md bg-zinc-950 mx-2 mb-2 p-2 font-mono text-xs md:mx-4 md:mb-4 md:p-3 md:text-sm ${
                        isMobile
                            ? isOutputExpanded ? 'h-[calc(50vh-60px)]' : 'h-[90px]'
                            : 'max-h-32'
                    }`}
                    style={{ WebkitOverflowScrolling: 'touch' }}
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
        </div>
    );
}
