"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ShieldCheck, Wallet, ClipboardList } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type WalletRow = { user_id: string; currency: string; is_frozen: boolean };
type LedgerRow = { id: string; user_id: string; amount: number; currency: string; entry_type: string; reason: string; created_at: string };

const box: React.CSSProperties = { background: "#fff", border: "1px solid #eaecf0", borderRadius: 14, padding: 16 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #d0d5dd", borderRadius: 9, padding: 11, font: "inherit", marginTop: 6 };

export default function WalletAdminPage() {
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const currency = "NGN";
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"credit" | "debit">("credit");
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) { setError(authError.message); return; }
    if (!user) { window.location.href = "/auth"; return; }
    const { data, error: rpcError } = await supabase.rpc("virtual_wallet_admin_recent_ledger");
    if (rpcError) { setError(rpcError.message); return; }
    setLedger((data ?? []) as LedgerRow[]);
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Please sign in with the administrator account.");
      if (!/^[0-9a-f-]{36}$/i.test(userId.trim())) throw new Error("Enter the target user's full account UUID.");
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isInteger(numericAmount * 100)) throw new Error("Enter a positive amount with at most 2 decimal places.");
      const { error: rpcError } = await supabase.rpc("virtual_wallet_admin_adjust", {
        p_user_id: userId.trim(), p_amount: numericAmount, p_currency: currency,
        p_reason: reason.trim(), p_idempotency_key: crypto.randomUUID(), p_action: action
      });
      if (rpcError) throw rpcError;
      setNotice(`Virtual wallet ${action} saved. This changes internal credits only, not real money.`);
      setAmount(""); setReason(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save wallet adjustment."); }
    finally { setBusy(false); }
  }

  return <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#101828", padding: "22px 16px 48px" }}>
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <Link href="/gift-cards/admin" style={{ display: "inline-flex", gap: 8, alignItems: "center", color: "#475467", textDecoration: "none", marginBottom: 18 }}><ArrowLeft size={17}/> Admin operations</Link>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Wallet size={30}/><div><h1 style={{ margin: 0, fontSize: 28 }}>Virtual wallet controls</h1><p style={{ color: "#667085", margin: "5px 0 0" }}>Add or remove internal test/service credits with an audit reason.</p></div></div><Link href="/gift-cards/admin/wallet/withdrawals" style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 9, padding: "10px 12px", background: "#eef4ff", color: "#1849a9", fontWeight: 700, textDecoration: "none" }}><ClipboardList size={16}/> Withdrawal review</Link></header>
      <section style={{ ...box, display: "flex", gap: 12, alignItems: "start", background: "#fffaeb", borderColor: "#fedf89", marginBottom: 16 }}><ShieldCheck size={22} color="#b54708"/><div><strong>Virtual credits only</strong><p style={{ margin: "5px 0 0", color: "#7a2e0e", lineHeight: 1.5 }}>These entries are not bank deposits, payment confirmations, or proof that cash is available. A separate real-money payout arrangement is required before any actual transfer.</p></div></section>
      {error && <p role="alert" style={{ background: "#fef3f2", color: "#b42318", padding: 12, borderRadius: 9 }}>{error}</p>}
      {notice && <p role="status" style={{ background: "#ecfdf3", color: "#027a48", padding: 12, borderRadius: 9 }}>{notice}</p>}
      <form onSubmit={submit} style={{ ...box, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>Wallet adjustment</h2>
        <label>Target user UUID<input required value={userId} onChange={e => setUserId(e.target.value)} placeholder="Paste the user's profile UUID" style={input}/></label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <label>Action<select value={action} onChange={e => setAction(e.target.value as "credit"|"debit")} style={input}><option value="credit">Add virtual balance</option><option value="debit">Remove virtual balance</option></select></label>
          <label>Amount<input required type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={input}/></label>
          <label>Currency<input value="NGN" readOnly style={input}/><small style={{color:"#667085"}}>Single-currency wallet is currently NGN. Multi-currency wallets are not implemented yet.</small></label>
        </div>
        <label>Reason (required for audit)<textarea required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why this adjustment is needed" rows={3} style={input}/></label>
        <button disabled={busy} style={{ justifySelf: "start", border: 0, borderRadius: 9, padding: "11px 16px", background: "#101828", color: "#fff", fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Save wallet adjustment"}</button>
      </form>
      <section style={{ ...box, marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><h2 style={{ margin: 0, fontSize: 19 }}>Recent ledger entries</h2><button onClick={() => void load()} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #d0d5dd", borderRadius: 8, padding: "8px 10px", background: "#fff" }}><RefreshCw size={15}/> Refresh</button></div>
        <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 650 }}><thead><tr>{["User","Entry","Amount","Reason","Created"].map(h=><th key={h} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #eaecf0", color: "#667085" }}>{h}</th>)}</tr></thead><tbody>{ledger.map(row=><tr key={row.id}>{[row.user_id,row.entry_type,`${row.currency} ${Number(row.amount).toFixed(2)}`,row.reason,new Date(row.created_at).toLocaleString()].map((v,i)=><td key={i} style={{ padding: 9, borderBottom: "1px solid #f2f4f7", fontSize: 13 }}>{v}</td>)}</tr>)}{!ledger.length&&<tr><td colSpan={5} style={{ padding: 14, color: "#667085" }}>No ledger entries yet, or the wallet operations migration has not been applied.</td></tr>}</tbody></table></div>
      </section>
    </div>
  </main>;
}
