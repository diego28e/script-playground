import { NextResponse, type NextRequest } from "next/server";

export default function authMiddleware(request: NextRequest) {
  const sessionToken = request.cookies.get("better-auth.session_token");

  if (!sessionToken) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
