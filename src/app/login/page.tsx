"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!email.trim() || password.length < 8) {
      setError("Enter a valid business email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        name: name.trim(),
        mode,
        redirect: false,
      });
      if (!result || result.error) {
        setError(
          mode === "register"
            ? "Could not create or sign in to this account. If you already registered, check your password."
            : "Invalid email or password. If this is your first time, switch to 'Create account' below.",
        );
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Sign-in service is temporarily unavailable. Check your database connection and try again.");
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        maxWidth: 460,
        margin: "8vh auto",
        padding: 32,
        background: "white",
        border: "1px solid #e0e8eb",
        borderRadius: 16,
        boxShadow: "0 12px 32px rgba(17, 39, 59, 0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            display: "inline-flex",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "#127a59",
            color: "white",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
          }}
        >
          l
        </span>
        <strong style={{ color: "#127a59", fontSize: 18 }}>ledgerly</strong>
      </div>

      <h1 style={{ fontSize: 26, color: "#11273b", margin: "8px 0" }}>
        {mode === "signin" ? "Sign in to your workspace" : "Create your Ledgerly account"}
      </h1>
      <p style={{ color: "#61737f", lineHeight: 1.5, fontSize: 14, marginBottom: 20 }}>
        Non-custodial financial operations and bookkeeping for Nigerian SMEs. Your session is protected by an HTTP-only cookie.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setError(null);
          }}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: mode === "signin" ? "2px solid #127a59" : "1px solid #d5dfe4",
            background: mode === "signin" ? "#effaf5" : "#f8fafb",
            color: "#11273b",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setError(null);
          }}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: mode === "register" ? "2px solid #127a59" : "1px solid #d5dfe4",
            background: mode === "register" ? "#effaf5" : "#f8fafb",
            color: "#11273b",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Create account
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            marginBottom: 16,
            borderRadius: 8,
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            color: "#a8071a",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        {mode === "register" && (
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600, color: "#11273b" }}>
            <span>Full Name</span>
            <input
              type="text"
              placeholder="e.g. Tunde Bakare"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              style={{
                padding: "11px 12px",
                borderRadius: 8,
                border: "1px solid #ccd6dd",
                fontSize: 14,
              }}
            />
          </label>
        )}

        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600, color: "#11273b" }}>
          <span>Business Email *</span>
          <input
            type="email"
            required
            placeholder="you@company.ng"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            style={{
              padding: "11px 12px",
              borderRadius: 8,
              border: "1px solid #ccd6dd",
              fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600, color: "#11273b" }}>
          <span>Password (min. 8 characters) *</span>
          <input
            type="password"
            required
            minLength={8}
            maxLength={128}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "11px 12px",
              borderRadius: 8,
              border: "1px solid #ccd6dd",
              fontSize: 14,
            }}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            marginTop: 6,
            padding: 14,
            border: 0,
            borderRadius: 8,
            color: "white",
            background: "#127a59",
            fontWeight: 700,
            fontSize: 15,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy
            ? "Signing in…"
            : mode === "signin"
              ? "Continue to workspace"
              : "Create account & continue"}
        </button>
      </form>
    </main>
  );
}
