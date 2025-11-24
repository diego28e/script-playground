import { betterFetch } from "@better-fetch/fetch";
import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "better-auth/types";

export default async function authMiddleware(request: NextRequest) {
    const baseURL = request.nextUrl.origin;
    console.log("[Middleware] Request URL:", request.url);
    console.log("[Middleware] Base URL:", baseURL);
    console.log("[Middleware] Fetching session from:", `${baseURL}/api/auth/get-session`);

    const { data: session } = await betterFetch<Session>(
        "/api/auth/get-session",
        {
            baseURL,
            headers: {
                //get the cookie from the request
                cookie: request.headers.get("cookie") || "",
            },
        },
    );

    if (!session) {
        return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
}

export const config = {
    matcher: ["/challenges/:path*"],
};
