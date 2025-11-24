import { createClient } from "@supabase/supabase-js";

console.log("[Supabase] Module loading");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("[Supabase] URL:", supabaseUrl);
console.log("[Supabase] Key exists:", !!supabaseKey);
console.log("[Supabase] Key first 10:", supabaseKey?.substring(0, 10));
console.log("[Supabase] Key length:", supabaseKey?.length);
console.log("[Supabase] Key type check - starts with eyJ:", supabaseKey?.startsWith('eyJ'));

if (!supabaseUrl) {
    console.error("[Supabase] Missing URL");
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabaseKey) {
    console.error("[Supabase] Missing Key");
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

if (!supabaseKey.startsWith('eyJ')) {
    console.error("[Supabase] WARNING: Key doesn't look like a JWT token (service_role key). You may be using anon key instead.");
}

console.log("[Supabase] Creating client");

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});

console.log("[Supabase] Client created");
