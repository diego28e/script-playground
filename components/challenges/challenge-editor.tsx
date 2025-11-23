"use client";

import { Editor } from "@monaco-editor/react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, Send, Settings } from "lucide-react";
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

export function ChallengeEditor({ initialCode, challengeId }: ChallengeEditorProps) {
    const [code, setCode] = useState(initialCode);
    const [output, setOutput] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [autoRun, setAutoRun] = useState(false);
    const autoRunTimeoutRef = useRef<NodeJS.Timeout>();

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

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-zinc-700 bg-[#1e1e1e] px-4 py-2">
                <span className="text-sm text-zinc-400">script.js</span>
                <div className="flex items-center gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-zinc-100">
                                <Settings className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuCheckboxItem
                                checked={autoRun}
                                onCheckedChange={setAutoRun}
                            >
                                Auto-run (1.5s delay)
                            </DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="text-zinc-400 hover:text-zinc-100"
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
            <div className="flex-1">
                <Editor
                    height="100%"
                    defaultLanguage="javascript"
                    theme="vs-dark"
                    value={code}
                    onChange={(value) => setCode(value || "")}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                    }}
                />
            </div>
            <div className="border-t border-zinc-700 bg-zinc-900 p-4">
                <h3 className="mb-2 text-sm font-semibold text-zinc-300">Output</h3>
                <div className="max-h-32 overflow-y-auto rounded-md bg-zinc-950 p-3 font-mono text-sm">
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
