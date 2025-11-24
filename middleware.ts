import { betterFetch } from "@better-fetch/fetch";
import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "better-auth/types";

export default async function authMiddleware(request: NextRequest) {
  const baseURL = process.env.BETTER_AUTH_URL || request.nextUrl.origin;
  console.log("[Middleware] Request URL:", request.url);
  console.log("[Middleware] Origin:", request.nextUrl.origin);
  console.log("[Middleware] BETTER_AUTH_URL:", process.env.BETTER_AUTH_URL);
  console.log("[Middleware] Using baseURL:", baseURL);

  const { data: session } = await betterFetch<Session>(
    "/api/auth/get-session",
    {
      baseURL,
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    }
  );

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
