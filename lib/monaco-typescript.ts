import type { Monaco } from "@monaco-editor/react";

// The browser's own TypeScript checks in the practice editors (docs/practice.md, "Languages"): squiggles and hover types
// while the learner types, set as close to the course's tsconfig as Monaco's built-in TypeScript allows (strict, modern
// JavaScript without the browser's). It is a helper, not the judge: the grader's tsc 7 with Node's real types decides,
// as the course says of the playground and the project (lesson 00.07). Node's modules and the test helpers are declared
// loosely here, so the editor doesn't mark what the grader accepts.

const GLOBALS = `
declare var console: { log(...data: unknown[]): void; error(...data: unknown[]): void; warn(...data: unknown[]): void; info(...data: unknown[]): void; table(data: unknown): void };
declare var process: { env: Record<string, string | undefined>; version: string; versions: Record<string, string>; argv: string[]; exitCode?: number; platform: string };
declare function setTimeout(handler: (...args: unknown[]) => void, ms?: number): unknown;
declare function clearTimeout(id: unknown): void;
declare function structuredClone<T>(value: T): T;
declare function fetch(input: string, init?: unknown): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
declare class AbortController { readonly signal: AbortSignal; abort(reason?: unknown): void }
declare class AbortSignal { readonly aborted: boolean; readonly reason: unknown; static timeout(ms: number): AbortSignal; static any(signals: AbortSignal[]): AbortSignal; throwIfAborted(): void; addEventListener(type: "abort", listener: () => void): void }
declare class URL { constructor(input: string, base?: string); href: string; pathname: string; searchParams: { get(name: string): string | null } }
/** A task's check (the grader provides it). */
declare function test(name: string, fn: () => void | Promise<void>): void;
/** Node's node:assert/strict (the grader provides it). */
declare const assert: { equal(actual: unknown, expected: unknown, message?: string): void; deepEqual(actual: unknown, expected: unknown, message?: string): void; ok(value: unknown, message?: string): void; throws(fn: () => unknown, expected?: unknown, message?: string): void; rejects(value: Promise<unknown> | (() => Promise<unknown>), expected?: unknown, message?: string): Promise<void> };
declare module "node:*";
`;

let configured = false;

/** Sets Monaco's TypeScript once per page: the course's strictness, no browser globals, and loose Node declarations. */
export function configureTypeScript(monaco: Monaco) {
  if (configured) return;
  configured = true;
  const ts = monaco.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    lib: ["esnext"],
    noEmit: true,
    allowNonTsExtensions: true,
    moduleDetection: 3,
  });
  ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  ts.typescriptDefaults.addExtraLib(GLOBALS, "file:///academia-globals.d.ts");
}
