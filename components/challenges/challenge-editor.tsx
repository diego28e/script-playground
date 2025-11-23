"use client";

import { Editor } from "@monaco-editor/react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, Send, Settings, Wand2, ChevronLeft, ChevronRight } from "lucide-react";
import { createSubmission } from "@/actions/submissions";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChallengeEditorProps {
    initialCode: string;
    challengeId: string;
}

interface ChallengeEditorProps {
    initialCode: string;
    challengeId: string;
    isDescriptionVisible: boolean;
    onToggleDescription: () => void;
}

export function ChallengeEditor({ initialCode, challengeId, isDescriptionVisible, onToggleDescription }: ChallengeEditorProps) {
    const [code, setCode] = useState(initialCode);
    const [output, setOutput] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [autoRun, setAutoRun] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('autoRun') === 'true';
        }
        return false;
    });
    const autoRunTimeoutRef = useRef<NodeJS.Timeout>();

    useEffect(() => {
        localStorage.setItem('autoRun', String(autoRun));
    }, [autoRun]);

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
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            console.log = originalConsole.log;
            console.error = originalConsole.error;
            console.warn = originalConsole.warn;
            setIsRunning(false);
        }
    };

    const handleSubmit = async () => {
        handleRun();
        
        const status = error ? 'FAILED' : 'PASSED';
        const result = await createSubmission({
            challengeId,
            code,
            status,
            output: output.join('\n'),
            error: error || undefined,
        });

        if (result.success) {
            toast.success(status === 'PASSED' ? 'Solution submitted!' : 'Submission saved');
        } else {
            toast.error('Failed to submit solution');
        }
    };

    const handleReset = () => {
        if (confirm('Reset to starter code? Your current code will be lost.')) {
            setCode(initialCode);
            setOutput([]);
            setError(null);
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
                plugins: [parserBabel, parserEstree],
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

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-zinc-700 bg-[#1e1e1e] px-2 py-2 md:px-4">
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onToggleDescription}
                        className="hidden text-zinc-400 hover:text-zinc-100 md:flex"
                        title={isDescriptionVisible ? "Hide description" : "Show description"}
                    >
                        {isDescriptionVisible ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                    <span className="text-xs text-zinc-400 md:text-sm">script.js</span>
                </div>
                <div className="flex items-center gap-1 md:gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-zinc-100">
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
                        Run
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSubmit}
                        className="text-blue-400 hover:text-blue-300"
                    >
                        <Send className="h-4 w-4" />
                        Submit
                    </Button>
                </div>
            </div>
            <div className="flex-1 min-h-0">
                <Editor
                    height="100%"
                    defaultLanguage="javascript"
                    theme="vs-dark"
                    value={code}
                    onChange={(value) => setCode(value || "")}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        wordWrap: "on",
                        wrappingStrategy: "advanced",
                    }}
                />
            </div>
            <div className="border-t border-zinc-700 bg-zinc-900 p-2 md:p-4">
                <h3 className="mb-2 text-xs font-semibold text-zinc-300 md:text-sm">Output</h3>
                <div className="max-h-24 overflow-y-auto rounded-md bg-zinc-950 p-2 font-mono text-xs md:max-h-32 md:p-3 md:text-sm">
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
