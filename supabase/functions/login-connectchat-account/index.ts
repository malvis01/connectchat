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

function normalizePhone(value: string): string {
  let phone = value.trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (/^0\d{10}$/.test(phone)) phone = "+234" + phone.slice(1);
  if (/^234\d{10}$/.test(phone)) phone = "+" + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Enter a valid ConnectChat number.");
  return phone;
}

function syntheticEmail(identifier: string): string {
  const encoded = btoa(identifier).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `p_${encoded.toLowerCase()}@qgsesjcpmvtykzzsleqx.supabase.co`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json();
    const identifier = String(body.identifier ?? "").trim().toUpperCase();
    const password = String(body.password ?? "");
    if (!identifier || !password) return jsonResponse({ error: "Enter your ConnectChat number and password." }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !serviceKey || !anonKey) return jsonResponse({ error: "Server authentication configuration is missing." }, 500);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    let phone: string | null = null;

    if (/^CC-\d{8}$/.test(identifier)) {
      const { data, error } = await admin.from("profiles").select("phone").eq("connectchat_number", identifier).maybeSingle();
      if (error) throw error;
      phone = data?.phone ?? null;
    } else {
      try {
        phone = normalizePhone(String(body.identifier ?? ""));
      } catch {
        return jsonResponse({ error: "Enter your assigned ConnectChat number." }, 400);
      }
      const { data, error } = await admin.from("profiles").select("phone").eq("phone", phone).maybeSingle();
      if (error) throw error;
      if (!data) phone = null;
    }

    if (!phone) return jsonResponse({ error: "Invalid ConnectChat number or password." }, 401);

    // Phone input is retained as a compatibility alias; all accounts authenticate
    // against the issued ConnectChat number after the identity migration.
    const profile = await admin.from("profiles").select("connectchat_number").eq("phone", phone).maybeSingle();
    if (profile.error) throw profile.error;
    const authIdentifier = profile.data?.connectchat_number
      ? profile.data.connectchat_number
      : phone;

    const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await auth.auth.signInWithPassword({
      email: syntheticEmail(authIdentifier),
      password,
    });
    if (error || !data.session) return jsonResponse({ error: "Invalid ConnectChat number or password." }, 401);

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
