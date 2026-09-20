"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, MessageCircle, Phone, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type Mode = "login" | "signup";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("signup");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    let normalizedPhone = phone.trim().replace(/[\s()-]/g, "");
    if (/^0\d{10}$/.test(normalizedPhone)) {
      normalizedPhone = "+234" + normalizedPhone.slice(1);
    }
    const normalizedUsername = username.trim().replace(/^@+/, "").toLowerCase();

    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      setMessage("Enter your phone number in international format, for example +2348012345678.");
      return;
    }

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }

    if (mode === "signup") {
      if (!fullName.trim()) {
        setMessage("Enter your full name.");
        return;
      }
      if (password !== confirmPassword) {
        setMessage("Passwords do not match.");
        return;
      }
      if (normalizedUsername && !/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
        setMessage("Username must be 3–30 characters using letters, numbers or underscores.");
        return;
      }
    }

    setBusy(true);

    try {
      if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        phone: normalizedPhone,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            username: normalizedUsername || null,
          },
        },
      });

      if (error) {
        setMessage(error.message);
        setBusy(false);
        return;
      }

      if (!data.user || !data.session) {
        setMessage("Account created, but phone confirmation is enabled. ConnectChat V1 requires phone confirmation to be disabled so no SMS/OTP is used.");
        setBusy(false);
        return;
      }

      const { error: profileError } = await supabase.from("profiles").upsert({
        id: data.user.id,
        phone: normalizedPhone,
        full_name: fullName.trim(),
        username: normalizedUsername || null,
      });

      if (profileError) {
        setMessage(profileError.message);
        setBusy(false);
        return;
      }

      window.location.href = "/chat";
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      phone: normalizedPhone,
      password,
    });

    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }

      window.location.href = "/chat";
      return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        phone: normalizedPhone,
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      window.location.href = "/chat";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo"><MessageCircle size={24} /></span>
          <div>
            <strong>ConnectChat</strong>
            <span>Private communication</span>
          </div>
        </div>

        <div className="auth-heading">
          <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p>Phone number and password only. No OTP or SMS verification in V1.</p>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && (
            <>
              <label>
                <span>Full name</span>
                <div className="auth-input">
                  <UserRound size={18} />
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" autoComplete="name" />
                </div>
              </label>

              <label>
                <span>Username <small>(optional)</small></span>
                <div className="auth-input">
                  <span className="auth-prefix">@</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="username" />
                </div>
              </label>
            </>
          )}

          <label>
            <span>Phone number</span>
            <div className="auth-input">
              <Phone size={18} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2348012345678" inputMode="tel" autoComplete="tel" />
            </div>
          </label>

          <label>
            <span>Password</span>
            <div className="auth-input">
              <LockKeyhole size={18} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </div>
          </label>

          {mode === "signup" && (
            <label>
              <span>Confirm password</span>
              <div className="auth-input">
                <LockKeyhole size={18} />
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" />
              </div>
            </label>
          )}

          {message && <p className="auth-message">{message}</p>}

          <button className="auth-submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>

        <button className="auth-switch" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); }}>
          {mode === "signup" ? "Already have an account? Log in" : "New to ConnectChat? Create an account"}
        </button>
      </section>
    </main>
  );
}
