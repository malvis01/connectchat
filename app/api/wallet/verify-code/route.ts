import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { createWalletSession } from "@/lib/wallet-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { client, user, authError } = await createWalletSession();
    if (authError || !user) return NextResponse.json({ error: "Sign in before verifying a code." }, { status: 401 });
    const body = await request.json() as { withdrawal_id?: unknown; code?: unknown };
    const withdrawalId = typeof body.withdrawal_id === "string" ? body.withdrawal_id : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(withdrawalId) || !/^\d{8}$/.test(code)) return NextResponse.json({ error: "Enter a valid withdrawal ID and 8-digit code." }, { status: 400 });
    const pepper = process.env.WALLET_WITHDRAWAL_CODE_PEPPER;
    if (!pepper || pepper.length < 32) return NextResponse.json({ error: "Withdrawal code verification is not configured." }, { status: 500 });
    const codeHash = createHmac("sha256", pepper).update(withdrawalId + ":" + code).digest("hex");
    const { data, error } = await client.rpc("virtual_wallet_verify_withdrawal_code", {
      p_withdrawal_id: withdrawalId, p_code_hash: codeHash
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (data !== true) return NextResponse.json({ error: "Code invalid, expired, already used, or attempts exhausted. Contact support." }, { status: 400 });
    return NextResponse.json({ verified: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify code." }, { status: 500 });
  }
}
