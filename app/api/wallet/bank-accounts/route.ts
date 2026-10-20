import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createCipheriv, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function encryptAccountNumber(value: string): string {
  const encodedKey = process.env.WALLET_BANK_DATA_ENCRYPTION_KEY;
  if (!encodedKey) throw new Error("Bank account encryption is not configured.");
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("Bank account encryption key must be 32 bytes encoded as base64.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

async function getUser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase public environment variables are not configured.");
  const cookieStore = await cookies();
  const session = createServerClient(url, publishableKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values) {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* Server Components may be read-only. */ }
      }
    }
  });
  const { data, error } = await session.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server-side Supabase service role is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return jsonError("Sign in to view saved bank accounts.", 401);
    const service = getServiceClient();
    const { data, error } = await service.from("virtual_wallet_bank_accounts")
      .select("id,country_code,bank_name,account_name,account_number_last4,currency,is_default,created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ accounts: data ?? [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load bank accounts.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return jsonError("Sign in before saving bank details.", 401);
    const body = await request.json() as Record<string, unknown>;
    const countryCode = typeof body.country_code === "string" ? body.country_code.trim().toUpperCase() : "";
    const bankName = typeof body.bank_name === "string" ? body.bank_name.trim() : "";
    const accountName = typeof body.account_name === "string" ? body.account_name.trim() : "";
    const accountNumber = typeof body.account_number === "string" ? body.account_number.replace(/\s+/g, "") : "";
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(countryCode)) return jsonError("Enter a valid two-letter country code.");
    if (bankName.length < 2 || bankName.length > 120) return jsonError("Bank name must be 2–120 characters.");
    if (accountName.length < 2 || accountName.length > 160) return jsonError("Account name must be 2–160 characters.");
    if (!/^\d{8,20}$/.test(accountNumber)) return jsonError("Account number must contain 8–20 digits.");
    if (!/^[A-Z]{3}$/.test(currency)) return jsonError("Enter a valid three-letter currency.");
    const encrypted = encryptAccountNumber(accountNumber);
    const service = getServiceClient();
    const { data: existing, error: existingError } = await service.from("virtual_wallet_bank_accounts")
      .select("id").eq("user_id", user.id).limit(1);
    if (existingError) throw existingError;
    const { data, error } = await service.from("virtual_wallet_bank_accounts").insert({
      user_id: user.id, country_code: countryCode, bank_name: bankName, account_name: accountName,
      account_number_ciphertext: encrypted, account_number_last4: accountNumber.slice(-4),
      currency, is_default: !existing?.length
    }).select("id,country_code,bank_name,account_name,account_number_last4,currency,is_default,created_at").single();
    if (error) throw error;
    return NextResponse.json({ account: data }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not save bank details.", 500);
  }
}
