"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, MessageCircle, Phone, UserRound, Copy, Check } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type Mode = "login" | "signup";

function normalizePhone(value: string): string {
  let phone = value.trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (/^0\d{10}$/.test(phone)) phone = "+234" + phone.slice(1);
  if (/^234\d{10}$/.test(phone)) phone = "+" + phone;
  return phone;
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("signup");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [issuedNumber, setIssuedNumber] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function callFunction(name: string, body: Record<string, string | null>) {
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!projectUrl || !publishableKey) throw new Error("Missing Supabase configuration.");
    const response = await fetch(projectUrl + "/functions/v1/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: publishableKey, Authorization: "Bearer " + publishableKey },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Authentication failed.");
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");

      if (mode === "signup") {
        const phone = normalizePhone(identifier);
        const normalizedUsername = username.trim().replace(/^@+/, "").toLowerCase();
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Enter a valid international phone number, e.g. +2348012345678.");
        if (!fullName.trim()) throw new Error("Enter your full name.");
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        if (normalizedUsername && !/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) throw new Error("Username must be 3–30 characters using letters, numbers or underscores.");

        const created = await callFunction("create-phone-account", {
          phone, password, fullName: fullName.trim(), username: normalizedUsername || null,
        });
        const connectchatNumber = String(created.connectchatNumber ?? "");
        if (!/^CC-\d{8}$/.test(connectchatNumber)) throw new Error("Your account was created, but ConnectChat did not return your account number. Contact support before signing out.");

        const login = await callFunction("login-connectchat-account", { identifier: connectchatNumber, password });
        const { error: sessionError } = await supabase.auth.setSession(login.session);
        if (sessionError) throw sessionError;
        setIssuedNumber(connectchatNumber);
        setIdentifier("");
        setPassword("");
        setConfirmPassword("");
        return;
      }

      const login = await callFunction("login-connectchat-account", { identifier: identifier.trim(), password });
      const { error: sessionError } = await supabase.auth.setSession(login.session);
      if (sessionError) throw sessionError;
      window.location.href = "/chat";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (issuedNumber) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-brand"><span className="auth-logo"><MessageCircle size={24}/></span><div><strong>ConnectChat</strong><span>Your account is ready</span></div></div>
          <div className="auth-heading"><h1>Your ConnectChat number</h1><p>Share this number so people can find and message you. Use it with your password whenever you log in.</p></div>
          <div className="connectchat-number-card"><strong>{issuedNumber}</strong><button type="button" onClick={async()=>{await navigator.clipboard.writeText(issuedNumber);setCopied(true);}}>{copied?<Check size={17}/>:<Copy size={17}/>} {copied?"Copied":"Copy number"}</button></div>
          <p className="auth-message">Save this number. Your phone number was not verified because you chose signup without OTP.</p>
          <button className="auth-submit" onClick={()=>{window.location.href="/chat";}}>Continue to ConnectChat</button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><span className="auth-logo"><MessageCircle size={24}/></span><div><strong>ConnectChat</strong><span>Private communication</span></div></div>
        <div className="auth-heading">
          <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p>{mode === "signup" ? "Register with your phone number and password. No OTP required." : "Log in with your ConnectChat number and password."}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && <>
            <label><span>Full name</span><div className="auth-input"><UserRound size={18}/><input value={fullName} onChange={(e)=>setFullName(e.target.value)} placeholder="Your full name" autoComplete="name" required/></div></label>
            <label><span>Username <small>(optional)</small></span><div className="auth-input"><span className="auth-prefix">@</span><input value={username} onChange={(e)=>setUsername(e.target.value)} placeholder="username" autoComplete="username"/></div></label>
          </>}
          <label><span>{mode === "signup" ? "Phone number" : "ConnectChat number"}</span><div className="auth-input"><Phone size={18}/><input value={identifier} onChange={(e)=>setIdentifier(e.target.value)} placeholder={mode === "signup" ? "+2348012345678" : "CC-10000001"} inputMode={mode === "signup" ? "tel" : "text"} autoComplete={mode === "signup" ? "tel" : "username"} required/></div></label>
          <label><span>Password</span><div className="auth-input"><LockKeyhole size={18}/><input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode === "signup" ? "new-password" : "current-password"} required/></div></label>
          {mode === "signup" && <label><span>Confirm password</span><div className="auth-input"><LockKeyhole size={18}/><input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" required/></div></label>}
          {message && <p className="auth-message">{message}</p>}
          <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}</button>
        </form>
        <button className="auth-switch" onClick={()=>{setMode(mode==="signup"?"login":"signup");setMessage("");setIdentifier("");}}>
          {mode === "signup" ? "Already have an account? Log in" : "New to ConnectChat? Create an account"}
        </button>
      </section>
    </main>
  );
}
