import { NextResponse, type NextRequest } from "next/server";

export default function authMiddleware(request: NextRequest) {
  const allCookies = request.cookies.getAll();
  console.log("[Middleware] All cookies:", allCookies.map(c => c.name));
  
  const sessionToken = request.cookies.get("better-auth.session_token");
  console.log("[Middleware] Session token exists:", !!sessionToken);

  if (!sessionToken) {
    console.log("[Middleware] No session token, redirecting to login");
    return NextResponse.redirect(new URL("/login", request.url));
  }

  console.log("[Middleware] Session token found, allowing request");
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
