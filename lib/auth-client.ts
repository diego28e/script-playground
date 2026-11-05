import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    // When the lab sends a student here to sign in, /login carries its signed request; this plugin passes it
    // along with the Google sign-in so the student lands back in the lab, signed in, without a second login.
    plugins: [oauthProviderClient()],
});
