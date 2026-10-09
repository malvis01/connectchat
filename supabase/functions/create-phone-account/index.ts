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

function normalizePhone(value: unknown): string {
  let phone = String(value ?? "").trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (/^0\d{10}$/.test(phone)) phone = "+234" + phone.slice(1);
  if (/^234\d{10}$/.test(phone)) phone = "+" + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("Enter a valid international phone number.");
  }
  return phone;
}

function syntheticEmail(phone: string): string {
  const encoded = btoa(phone)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `p_${encoded.toLowerCase()}@qgsesjcpmvtykzzsleqx.supabase.co`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  let stage = "reading request";
  let createdUserId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const body = await req.json();
    const phone = normalizePhone(body.phone);
    const password = String(body.password ?? "");
    const fullName = String(body.fullName ?? "").trim();
    const username = String(body.username ?? "").trim().replace(/^@+/, "").toLowerCase();

    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (!fullName) throw new Error("Enter your full name.");
    if (username && !/^[a-z0-9_]{3,30}$/.test(username)) {
      throw new Error("Username must be 3–30 characters using letters, numbers or underscores.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
    if (!supabaseUrl || !secretKey) {
      throw new Error("Server authentication configuration is missing.");
    }

    admin = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = syntheticEmail(phone);

    stage = "checking existing profile";
    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles").select("id").eq("phone", phone).maybeSingle();
    if (profileLookupError) throw profileLookupError;
    if (existingProfile) throw new Error("An account already exists for this phone number.");

    stage = "creating auth user";
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: { full_name: fullName, username: username || null, phone },
    });
    if (createError) {
      if (/already|registered|exists/i.test(createError.message)) {
        throw new Error("An account already exists for this phone number.");
      }
      throw createError;
    }
    if (!created.user?.id) throw new Error("Supabase did not return a new user ID.");
    createdUserId = created.user.id;

    stage = "creating profile";
    const { error: insertError } = await admin.from("profiles").insert({
      id: createdUserId,
      phone,
      full_name: fullName,
      username: username || null,
    });
    if (insertError) throw insertError;

    return jsonResponse({ ok: true, phone });
  } catch (error) {
    if (createdUserId && admin) {
      try { await admin.auth.admin.deleteUser(createdUserId); } catch { /* preserve original error */ }
    }
    return jsonResponse({
      error: error instanceof Error ? error.message : "Account creation failed.",
      stage,
    }, 400);
  }
});