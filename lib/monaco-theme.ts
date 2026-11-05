import type { Monaco } from "@monaco-editor/react";

// The Monaco theme for code surfaces, which stay dark in both platform themes. Colours follow the --code-*
// tokens in app/globals.css (Monaco needs literal hex, not CSS variables), with the chartreuse signal as cursor.
export function defineAcademiaTheme(monaco: Monaco) {
  monaco.editor.defineTheme("academia-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7891", fontStyle: "italic" },
      { token: "keyword", foreground: "c8f24e" },
      { token: "string", foreground: "f2b155" },
      { token: "number", foreground: "9db4ff" },
    ],
    colors: {
      "editor.background": "#0f1520",
      "editor.foreground": "#e8ecf2",
      "editor.lineHighlightBackground": "#141b26",
      "editor.selectionBackground": "#2c3a4f",
      "editorCursor.foreground": "#c8f24e",
      "editorLineNumber.foreground": "#4a5568",
      "editorLineNumber.activeForeground": "#98a2b3",
      "editorIndentGuide.background1": "#1c2533",
      "editorGutter.background": "#0f1520",
      "editorWidget.background": "#141b26",
      "editorWidget.border": "#263142",
    },
  });
}
