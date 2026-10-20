"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Wallet, PlusCircle } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type Summary = { currency: string; balance: number; is_frozen: boolean };
type Ledger = { id: string; amount: number; currency: string; entry_type: string; reason: string; created_at: string };
type Withdrawal = { id: string; amount: number; currency: string; status: string; user_note: string | null; admin_note: string | null; created_at: string };
type BankAccount = { id: string; country_code: string; bank_name: string; account_name: string; account_number_last4: string; currency: string; is_default: boolean; created_at: string };

const panel: React.CSSProperties = { background: "#fff", border: "1px solid #eaecf0", borderRadius: 14, padding: 16 };
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #d0d5dd", borderRadius: 9, padding: 10, font: "inherit", marginTop: 5 };

export default function WalletPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [country, setCountry] = useState("NG");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [selectedBank, setSelectedBank] = useState("");
  const [amount, setAmount] = useState("");
  const [withdrawalNote, setWithdrawalNote] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) { window.location.href = "/auth"; return; }
      const [summaryResult, ledgerResult, withdrawalResult, bankResult] = await Promise.all([
        supabase.rpc("virtual_wallet_my_summary"),
        supabase.from("virtual_wallet_ledger").select("id,amount,currency,entry_type,reason,created_at").order("created_at", { ascending: false }).limit(30),
        supabase.from("virtual_wallet_withdrawals").select("id,amount,currency,status,user_note,admin_note,created_at").order("created_at", { ascending: false }).limit(30),
        fetch("/api/wallet/bank-accounts", { cache: "no-store" })
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (ledgerResult.error) throw ledgerResult.error;
      if (withdrawalResult.error) throw withdrawalResult.error;
      if (!bankResult.ok) {
        const body = await bankResult.json().catch(() => ({}));
        throw new Error(body.error || "Could not load saved bank accounts.");
      }
      const bankJson = await bankResult.json();
      setSummary(summaryResult.data as Summary);
      setLedger((ledgerResult.data ?? []) as Ledger[]);
      setWithdrawals((withdrawalResult.data ?? []) as Withdrawal[]);
      setBanks((bankJson.accounts ?? []) as BankAccount[]);
      setSelectedBank(current => current || bankJson.accounts?.[0]?.id || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load wallet."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveBank(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/wallet/bank-accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country_code: country, bank_name: bankName, account_name: accountName, account_number: accountNumber, currency })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save bank details.");
      setAccountNumber(""); setBankName(""); setAccountName("");
      setSelectedBank(body.account.id);
      setNotice("Bank account saved securely. The account number is encrypted and only its last four digits are displayed.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save bank details."); }
    finally { setBusy(false); }
  }

  async function requestWithdrawal(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (!selectedBank) throw new Error("Save or select a bank account first.");
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isInteger(numericAmount * 100)) throw new Error("Enter a positive amount with at most two decimal places.");
      const { data, error: rpcError } = await supabase.rpc("virtual_wallet_request_withdrawal", {
        p_bank_account_id: selectedBank, p_amount: numericAmount, p_currency: summary?.currency ?? "NGN",
        p_user_note: withdrawalNote.trim() || null, p_idempotency_key: crypto.randomUUID()
      });
      if (rpcError) throw rpcError;
      setNotice("Withdrawal request created and balance reserved. Contact support for identity verification; this is not a bank transfer.");
      setAmount(""); setWithdrawalNote(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create withdrawal request."); }
    finally { setBusy(false); }
  }

  async function verifyCode(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const code = (codes[id] ?? "").trim();
      if (!/^\d{8}$/.test(code)) throw new Error("Enter the 8-digit verification code supplied by official ConnectChat support.");
      const response = await fetch("/api/wallet/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ withdrawal_id: id, code }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not verify code.");
      setNotice("Verification succeeded. The request is now awaiting administrator payout review; verification does not send money.");
      setCodes(current => ({ ...current, [id]: "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not verify code."); }
    finally { setBusy(false); }
  }

  return <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#101828", padding: "22px 16px 48px" }}><div style={{ maxWidth: 980, margin: "0 auto" }}>
    <Link href="/" style={{ display: "inline-flex", gap: 8, alignItems: "center", color: "#475467", textDecoration: "none", marginBottom: 18 }}><ArrowLeft size={17}/> ConnectChat</Link>
    <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}><Wallet size={30}/><div><h1 style={{ margin: 0, fontSize: 28 }}>My virtual wallet</h1><p style={{ color: "#667085", margin: "5px 0 0" }}>Internal platform credits and withdrawal request history.</p></div></header>
    {error && <p role="alert" style={{ background: "#fef3f2", color: "#b42318", padding: 12, borderRadius: 9 }}>{error}</p>}
    {notice && <p role="status" style={{ background: "#ecfdf3", color: "#027a48", padding: 12, borderRadius: 9 }}>{notice}</p>}
    {loading ? <section style={panel}>Loading wallet…</section> : <>
      <section style={{ ...panel, background: "#101828", color: "#fff" }}><div style={{ opacity: .8, fontSize: 14 }}>Available virtual balance</div><strong style={{ display: "block", fontSize: 34, marginTop: 8 }}>{summary?.currency ?? "NGN"} {Number(summary?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><p style={{ margin: "8px 0 0", opacity: .8 }}>{summary?.is_frozen ? "This wallet is frozen. Contact support." : "Internal credits only—not a cash or bank balance."}</p></section>
      <section style={{ ...panel, marginTop: 14, background: "#fffaeb", borderColor: "#fedf89" }}><strong>Important: virtual credits are not real money</strong><p style={{ margin: "6px 0 0", color: "#7a2e0e", lineHeight: 1.5 }}>Adding a bank account does not create a payout facility. Withdrawals require administrator review and a separately funded, compliant payout provider. Never pay anyone to receive a verification code.</p></section>
      <section style={{ ...panel, marginTop: 16 }}><h2 style={{ margin: "0 0 12px", fontSize: 19 }}>Bank details for withdrawal requests</h2>
        <form onSubmit={saveBank} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <label>Country code<input value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} required style={field}/></label>
            <label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)} style={field}><option value="NGN">NGN — Nigerian naira</option></select></label>
            <label>Bank name<input value={bankName} onChange={e => setBankName(e.target.value)} required minLength={2} maxLength={120} style={field}/></label>
            <label>Account name<input value={accountName} onChange={e => setAccountName(e.target.value)} required minLength={2} maxLength={160} style={field}/></label>
            <label>Account number<input inputMode="numeric" autoComplete="off" value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g,"").slice(0,20))} required minLength={8} maxLength={20} style={field}/></label>
          </div>
          <button disabled={busy} style={{ justifySelf: "start", display: "inline-flex", gap: 7, alignItems: "center", border: 0, borderRadius: 9, padding: "10px 13px", background: "#101828", color: "#fff", fontWeight: 700 }}><PlusCircle size={16}/>{busy ? "Saving…" : "Save encrypted bank account"}</button>
        </form>
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>{banks.map(bank=><label key={bank.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: 11, border: selectedBank===bank.id ? "1px solid #101828" : "1px solid #eaecf0", borderRadius: 10 }}><input type="radio" name="bank" checked={selectedBank===bank.id} onChange={()=>setSelectedBank(bank.id)}/><span><strong>{bank.bank_name}</strong><br/><small style={{ color: "#667085" }}>{bank.account_name} · •••• {bank.account_number_last4} · {bank.currency}</small></span></label>)}{!banks.length&&<p style={{ color: "#667085", margin: 0 }}>No bank accounts saved yet.</p>}</div>
      </section>
      <section style={{ ...panel, marginTop: 16 }}><h2 style={{ margin: "0 0 12px", fontSize: 19 }}>Request withdrawal</h2>
        <form onSubmit={requestWithdrawal} style={{ display: "grid", gap: 10 }}>
          <label>Amount in {summary?.currency ?? "NGN"}<input type="number" min="0.01" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} style={field}/></label>
          <label>Note for support (optional)<textarea value={withdrawalNote} onChange={e=>setWithdrawalNote(e.target.value)} maxLength={500} rows={2} style={field}/></label>
          <button disabled={busy || !!summary?.is_frozen || !banks.length} style={{ justifySelf: "start", border: 0, borderRadius: 9, padding: "10px 14px", background: "#175cd3", color: "#fff", fontWeight: 700 }}>{busy ? "Submitting…" : "Create withdrawal request"}</button>
        </form>
      </section>
      <section style={{ ...panel, marginTop: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><h2 style={{ margin: 0, fontSize: 19 }}>Withdrawal requests</h2><button onClick={() => void load()} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid #d0d5dd", borderRadius: 8, padding: "8px 10px", background: "#fff" }}><RefreshCw size={15}/> Refresh</button></div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>{withdrawals.map(w=><article key={w.id} style={{ border: "1px solid #eaecf0", borderRadius: 10, padding: 12 }}><strong>{w.currency} {Number(w.amount).toFixed(2)}</strong><span style={{ marginLeft: 10, fontSize: 12, padding: "4px 7px", borderRadius: 7, background: "#f2f4f7" }}>{w.status.replaceAll("_"," ")}</span><p style={{ margin: "6px 0", color: "#667085", fontSize: 13 }}>Request {w.id} · {new Date(w.created_at).toLocaleString()}</p>{(w.admin_note || w.user_note) && <p style={{ margin: "5px 0", fontSize: 13 }}>{w.admin_note || w.user_note}</p>}
          {w.status === "pending_verification" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}><input aria-label="8 digit support verification code" inputMode="numeric" maxLength={8} value={codes[w.id] ?? ""} onChange={e=>setCodes(s=>({...s,[w.id]:e.target.value.replace(/\D/g,"").slice(0,8)}))} placeholder="8-digit support code" style={{ ...field, width: 190, marginTop: 0 }}/><button disabled={busy} onClick={()=>void verifyCode(w.id)} style={{ border: 0, borderRadius: 8, padding: "9px 12px", background: "#175cd3", color: "#fff", fontWeight: 700 }}>Verify code</button></div>}
        </article>)}{!withdrawals.length&&<p style={{ color: "#667085" }}>No withdrawal requests yet.</p>}</div>
      </section>
      <section style={{ ...panel, marginTop: 16 }}><h2 style={{ margin: "0 0 10px", fontSize: 19 }}>Recent transactions</h2><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}><thead><tr>{["Type","Amount","Reason","Created"].map(h=><th key={h} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #eaecf0", color: "#667085" }}>{h}</th>)}</tr></thead><tbody>{ledger.map(l=><tr key={l.id}>{[l.entry_type.replaceAll("_"," "),`${l.currency} ${Number(l.amount).toFixed(2)}`,l.reason,new Date(l.created_at).toLocaleString()].map((v,i)=><td key={i} style={{ padding: 9, borderBottom: "1px solid #f2f4f7", fontSize: 13 }}>{v}</td>)}</tr>)}{!ledger.length&&<tr><td colSpan={4} style={{ padding: 14, color: "#667085" }}>No transactions yet.</td></tr>}</tbody></table></div></section>
    </>}
  </div></main>;
}
