"use client";

import { Editor } from "@monaco-editor/react";
import { useState } from "react";

interface ChallengeEditorProps {
    initialCode: string;
}

export function ChallengeEditor({ initialCode }: ChallengeEditorProps) {
    const [code, setCode] = useState(initialCode);

    return (
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
    );
}
