"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/feedback/page-states";

// Any error thrown while rendering a page here (a database outage, a bug) lands on this card instead of a blank
// screen. "Try again" re-renders the page; the reference matches the error in the server logs.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error);
    }, [error]);
    return <ErrorState retry={reset} digest={error.digest} />;
}
