import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prisma } from "./prisma";
import { labGroups } from "./lab-access";

export const auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    user: {
        additionalFields: {
            role: {
                type: "string",
                required: false,
                defaultValue: "USER",
            },
        },
    },
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
    },
    // The jwt plugin signs ID tokens for the OpenID Connect provider below; clients get tokens from
    // /oauth2/token, so the jwt plugin's own /token route stays off.
    disabledPaths: ["/token"],
    plugins: [
        jwt(),
        // The platform is the identity provider for the lab (lab.academiadelcodigo.com): the hub sends students
        // here to sign in, and lets in the ones whose `groups` claim says so (lib/lab-access.ts). Students sign
        // in once, with Google, on the platform.
        oauthProvider({
            loginPage: "/login",
            consentPage: "/consent",
            scopes: ["openid", "profile", "email"],
            // The lab signs in with a code; it needs no refresh tokens or machine-to-machine tokens.
            grantTypes: ["authorization_code"],
            // Only platform admins may create or change clients (the lab's is made at /admin/lab-access), so
            // nobody else can register an app that asks students to sign in.
            clientPrivileges: ({ user, action }) => user?.role === "ADMIN" && action !== "configure-client-credentials-scopes",
            customUserInfoClaims: async ({ user }) => ({ groups: await labGroups(user.id) }),
            advertisedMetadata: {
                scopes_supported: ["openid", "profile", "email"],
                claims_supported: ["sub", "iss", "aud", "exp", "iat", "sid", "scope", "azp", "name", "picture", "email", "email_verified", "groups"],
            },
        }),
    ],
});
