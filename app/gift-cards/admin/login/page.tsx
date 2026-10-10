"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

export default function GiftCardAdminLoginPage() {
  const [email, setEmail] = useState("malvisdabz@gmail.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw new Error("Email or password is incorrect.");

      // The database function is the authority for admin access; a successful
      // email/password login alone must never grant administrator privileges.
      const { error: accessError } = await supabase.rpc("gift_card_admin_overview");
      if (accessError) {
        await supabase.auth.signOut();
        throw new Error("This account is not yet authorized as a marketplace administrator. Ask the project owner to provision it securely.");
      }

      window.location.href = "/gift-cards/admin";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#f8fafc", color: "#101828" }}>
      <section style={{ width: "100%", maxWidth: 440, padding: 26, border: "1px solid #eaecf0", borderRadius: 18, background: "#fff", boxShadow: "0 10px 35px rgba(16,24,40,.06)" }}>
        <Link href="/gift-cards" style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#475467", textDecoration: "none", marginBottom: 24 }}><ArrowLeft size={16}/> Marketplace</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <span style={{ display: "grid", placeItems: "center", width: 48, height: 48, borderRadius: 14, background: "#eef2ff", color: "#4338ca" }}><ShieldCheck size={25}/></span>
          <div><h1 style={{ margin: 0, fontSize: 25 }}>Admin sign in</h1><p style={{ margin: "5px 0 0", color: "#667085" }}>ConnectChat Gift Card Marketplace</p></div>
        </div>
        <form onSubmit={submit}>
          <label style={{ display: "block", marginBottom: 15, fontWeight: 600 }}>Admin email
            <span style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 7, padding: "0 12px", border: "1px solid #d0d5dd", borderRadius: 10 }}>
              <Mail size={17} color="#667085"/><input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} style={{ minWidth: 0, width: "100%", padding: "12px 0", border: 0, outline: 0, font: "inherit" }}/>
            </span>
          </label>
          <label style={{ display: "block", marginBottom: 15, fontWeight: 600 }}>Password
            <span style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 7, padding: "0 12px", border: "1px solid #d0d5dd", borderRadius: 10 }}>
              <LockKeyhole size={17} color="#667085"/><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} style={{ minWidth: 0, width: "100%", padding: "12px 0", border: 0, outline: 0, font: "inherit" }}/>
            </span>
          </label>
          {error && <p role="alert" style={{ padding: 12, borderRadius: 9, background: "#fef3f2", color: "#b42318", lineHeight: 1.5 }}>{error}</p>}
          <button type="submit" disabled={busy} style={{ width: "100%", padding: 13, border: 0, borderRadius: 10, background: "#101828", color: "#fff", fontWeight: 750, cursor: busy ? "wait" : "pointer" }}>{busy ? "Checking access…" : "Sign in to admin"}</button>
        </form>
        <p style={{ margin: "17px 0 0", fontSize: 12, lineHeight: 1.6, color: "#667085" }}>Only an account explicitly provisioned in the protected admin table can open this dashboard. The password is never stored in this page's source code.</p>
      </section>
    </main>
  );
}
