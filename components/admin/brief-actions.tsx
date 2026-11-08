"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** The video brief's two ways out: download the file, or copy its text. */
export function BriefActions({ markdown, downloadHref, filename }: { markdown: string; downloadHref: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("The browser didn't let us copy. Download the file instead.");
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => void copy()}>
        {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button asChild>
        <a href={downloadHref} download={filename}>
          <Download className="mr-2 size-4" /> Download
        </a>
      </Button>
    </div>
  );
}
