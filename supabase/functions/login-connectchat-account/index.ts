import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function syntheticEmail(identifier: string): string {
  const encoded = btoa(identifier).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return \`p_\${encoded.toLowerCase()}@qgsesjcpmvtykzzsleqx.supabase.co\`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json();
    const identifier = String(body.identifier ?? "").trim().toUpperCase();
    const password = String(body.password ?? "");
    if (!/^CC-\d{8}$/.test(identifier) || !password) {
      return jsonResponse({ error: "Enter your ConnectChat number and password." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !serviceKey || !anonKey) {
      return jsonResponse({ error: "Server authentication configuration is missing." }, 500);
    }

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("connectchat_number")
      .eq("connectchat_number", identifier)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.connectchat_number) {
      return jsonResponse({ error: "Invalid ConnectChat number or password." }, 401);
    }

    const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await auth.auth.signInWithPassword({
      email: syntheticEmail(profile.connectchat_number),
      password,
    });
    if (error || !data.session) {
      return jsonResponse({ error: "Invalid ConnectChat number or password." }, 401);
    }

    return jsonResponse({
      ok: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Sign-in failed." }, 400);
  }
});
