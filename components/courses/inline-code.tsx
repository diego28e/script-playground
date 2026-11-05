import { Fragment } from "react";

// Course titles carry Markdown code spans ("Chat models and `init_chat_model`"); render those, and nothing else.
export function InlineCode({ text }: { text: string }) {
    return text.split(/(`[^`]+`)/).map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
            <code key={index} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
                {part.slice(1, -1)}
            </code>
        ) : (
            <Fragment key={index}>{part}</Fragment>
        ),
    );
}

/** "~16 h" for a total in minutes. */
export function formatHours(minutes: number) {
    return minutes >= 60 ? `~${Math.round(minutes / 60)} h` : `${minutes} min`;
}
