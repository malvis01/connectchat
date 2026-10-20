import { createHmac, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { createWalletSession } from "@/lib/wallet-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { client, user, authError } = await createWalletSession();
    if (authError || !user) return NextResponse.json({ error: "Sign in with an administrator account." }, { status: 401 });
    const body = await request.json() as { withdrawal_id?: unknown };
    const withdrawalId = typeof body.withdrawal_id === "string" ? body.withdrawal_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(withdrawalId)) return NextResponse.json({ error: "Invalid withdrawal ID." }, { status: 400 });
    const pepper = process.env.WALLET_WITHDRAWAL_CODE_PEPPER;
    if (!pepper || pepper.length < 32) return NextResponse.json({ error: "Withdrawal code signing is not configured." }, { status: 500 });
    const code = String(randomInt(0, 100000000)).padStart(8, "0");
    const codeHash = createHmac("sha256", pepper).update(withdrawalId + ":" + code).digest("hex");
    const { error } = await client.rpc("virtual_wallet_admin_issue_code", {
      p_withdrawal_id: withdrawalId,
      p_code_hash: codeHash,
      p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ code, expires_in_minutes: 15 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not issue support code." }, { status: 500 });
  }
}
