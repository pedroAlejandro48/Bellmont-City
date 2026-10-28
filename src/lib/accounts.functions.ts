import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { usernameLoginSchema } from "./usernames";

// Only credentials are returned, never the privately resolved email address.
export const signInWithUsername = createServerFn({ method: "POST" })
  .inputValidator((input) => usernameLoginSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: email, error } = await supabaseAdmin.rpc("username_login_email", { candidate: data.username });
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
    if (!url || !key) throw new Error("Sign-in is temporarily unavailable.");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      } },
    });
    const result = await client.auth.signInWithPassword({
      email: !error && email ? email : "unknown-player@invalid.example", password: data.password,
    });
    if (error || !email || result.error || !result.data.session) return { error: "Incorrect username or password.", tokens: null };
    return { error: null, tokens: { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token } };
  });