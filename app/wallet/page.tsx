"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type Summary = { currency: string; balance: number; is_frozen: boolean };
type Ledger = { id: string; amount: number; currency: string; entry_type: string; reason: string; created_at: string };
type Withdrawal = { id: string; amount: number; currency: string; status: string; user_note: string | null; admin_note: string | null; created_at: string };

const panel: React.CSSProperties = { background: "#fff", border: "1px solid #eaecf0", borderRadius: 14, padding: 16 };
export default function WalletPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) { window.location.href = "/auth"; return; }
      const [summaryResult, ledgerResult, withdrawalResult] = await Promise.all([
        supabase.rpc("virtual_wallet_my_summary"),
        supabase.from("virtual_wallet_ledger").select("id,amount,currency,entry_type,reason,created_at").order("created_at", { ascending: false }).limit(30),
        supabase.from("virtual_wallet_withdrawals").select("id,amount,currency,status,user_note,admin_note,created_at").order("created_at", { ascending: false }).limit(30)
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (ledgerResult.error) throw ledgerResult.error;
      if (withdrawalResult.error) throw withdrawalResult.error;
      setSummary(summaryResult.data as Summary);
      setLedger((ledgerResult.data ?? []) as Ledger[]);
      setWithdrawals((withdrawalResult.data ?? []) as Withdrawal[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load wallet."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#101828", padding: "22px 16px 48px" }}><div style={{ maxWidth: 980, margin: "0 auto" }}>
    <Link href="/" style={{ display: "inline-flex", gap: 8, alignItems: "center", color: "#475467", textDecoration: "none", marginBottom: 18 }}><ArrowLeft size={17}/> ConnectChat</Link>
    <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}><Wallet size={30}/><div><h1 style={{ margin: 0, fontSize: 28 }}>My virtual wallet</h1><p style={{ color: "#667085", margin: "5px 0 0" }}>Internal platform credits and withdrawal request history.</p></div></header>
    {error && <p role="alert" style={{ background: "#fef3f2", color: "#b42318", padding: 12, borderRadius: 9 }}>{error}</p>}
    {loading ? <section style={panel}>Loading wallet…</section> : <>
      <section style={{ ...panel, background: "#101828", color: "#fff" }}><div style={{ opacity: .8, fontSize: 14 }}>Available virtual balance</div><strong style={{ display: "block", fontSize: 34, marginTop: 8 }}>{summary?.currency ?? "NGN"} {Number(summary?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><p style={{ margin: "8px 0 0", opacity: .8 }}>{summary?.is_frozen ? "This wallet is frozen. Contact support." : "This is an internal ledger balance, not cash or a bank balance."}</p></section>
      <section style={{ ...panel, marginTop: 14, background: "#fffaeb", borderColor: "#fedf89" }}><strong>Withdrawals are not automatic bank transfers</strong><p style={{ margin: "6px 0 0", color: "#7a2e0e", lineHeight: 1.5 }}>To start a withdrawal request, contact ConnectChat support. Support will check your account and an administrator may issue a time-limited, one-use verification code. Never pay anyone to receive a code. Real payouts remain subject to separate approval and an available payout provider.</p></section>
      <section style={{ ...panel, marginTop: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><h2 style={{ margin: 0, fontSize: 19 }}>Withdrawal requests</h2><button onClick={() => void load()} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid #d0d5dd", borderRadius: 8, padding: "8px 10px", background: "#fff" }}><RefreshCw size={15}/> Refresh</button></div><div style={{ overflowX: "auto", marginTop: 10 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}><thead><tr>{["Request","Amount","Status","Note","Created"].map(h=><th key={h} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #eaecf0", color: "#667085" }}>{h}</th>)}</tr></thead><tbody>{withdrawals.map(w=><tr key={w.id}>{[w.id.slice(0,8),`${w.currency} ${Number(w.amount).toFixed(2)}`,w.status.replaceAll("_"," "),w.admin_note||w.user_note||"—",new Date(w.created_at).toLocaleString()].map((v,i)=><td key={i} style={{ padding: 9, borderBottom: "1px solid #f2f4f7", fontSize: 13 }}>{v}</td>)}</tr>)}{!withdrawals.length&&<tr><td colSpan={5} style={{ padding: 14, color: "#667085" }}>No withdrawal requests yet.</td></tr>}</tbody></table></div></section>
      <section style={{ ...panel, marginTop: 16 }}><h2 style={{ margin: "0 0 10px", fontSize: 19 }}>Recent transactions</h2><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}><thead><tr>{["Type","Amount","Reason","Created"].map(h=><th key={h} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #eaecf0", color: "#667085" }}>{h}</th>)}</tr></thead><tbody>{ledger.map(l=><tr key={l.id}>{[l.entry_type.replaceAll("_"," "),`${l.currency} ${Number(l.amount).toFixed(2)}`,l.reason,new Date(l.created_at).toLocaleString()].map((v,i)=><td key={i} style={{ padding: 9, borderBottom: "1px solid #f2f4f7", fontSize: 13 }}>{v}</td>)}</tr>)}{!ledger.length&&<tr><td colSpan={4} style={{ padding: 14, color: "#667085" }}>No transactions yet.</td></tr>}</tbody></table></div></section>
    </>}
  </div></main>;
}
