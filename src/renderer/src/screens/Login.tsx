import React, { useState } from "react";
import logo from "../assets/logo.png";

// ─── Hardcoded credentials (phase 1 — no server yet) ───────────────────────
// Phase 2: replace this with a POST to the central QA Buddy server.
// The server will look up the user's saved Jira & Confluence tokens by username
// and return them as part of the login response, so the user never has to
// paste tokens manually again.
const STATIC_USERS: Record<string, string> = {
  "00400291": "Undeadjokowi12!",
};

interface Props {
  onLogin: (username: string) => void;
}

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Simulate a tiny async delay so it feels like a real auth call
    await new Promise((r) => setTimeout(r, 400));

    const expected = STATIC_USERS[username.trim()];
    if (expected && expected === password) {
      onLogin(username.trim());
    } else {
      setError("Username atau password salah.");
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          padding: "0 24px",
        }}
      >
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <img src={logo} alt="QA Buddy" style={{ width: 56, height: 56, marginBottom: 14 }} />
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: "var(--on-surface)" }}>
            QA Buddy
          </h1>
          <p style={{ fontSize: 13, color: "var(--on-surface-variant)", margin: 0 }}>
            Quality Engineering Hub — BRI/BFLP
          </p>
        </div>

        {/* Card */}
        <div
          className="card"
          style={{ padding: "32px 28px", borderRadius: 16 }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 24px", color: "var(--on-surface)" }}>
            Masuk ke akun Anda
          </h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Username */}
            <div className="field-group">
              <label style={{ fontSize: 13, fontWeight: 500 }}>Username (Employee ID)</label>
              <div style={{ position: "relative" }}>
                <span
                  className="material-symbols"
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 18,
                    color: "var(--on-surface-variant)",
                    pointerEvents: "none",
                  }}
                >
                  badge
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(null); }}
                  placeholder="e.g. 00400291"
                  autoComplete="username"
                  autoFocus
                  required
                  style={{ paddingLeft: 40, width: "100%" }}
                />
              </div>
            </div>

            {/* Password */}
            <div className="field-group">
              <label style={{ fontSize: 13, fontWeight: 500 }}>Password</label>
              <div style={{ position: "relative" }}>
                <span
                  className="material-symbols"
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 18,
                    color: "var(--on-surface-variant)",
                    pointerEvents: "none",
                  }}
                >
                  lock
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  style={{ paddingLeft: 40, paddingRight: 44, width: "100%" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--on-surface-variant)",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                  }}
                  tabIndex={-1}
                >
                  <span className="material-symbols" style={{ fontSize: 18 }}>
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--error)",
                  background: "rgba(var(--error-rgb, 220,38,38), 0.08)",
                  border: "1px solid rgba(var(--error-rgb, 220,38,38), 0.25)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span className="material-symbols" style={{ fontSize: 16, flexShrink: 0 }}>error</span>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              className="primary-button"
              disabled={loading}
              style={{ width: "100%", height: 44, fontSize: 15, borderRadius: 10, marginTop: 4 }}
            >
              {loading ? (
                <>
                  <span className="material-symbols" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>
                    progress_activity
                  </span>
                  Masuk...
                </>
              ) : (
                <>
                  <span className="material-symbols" style={{ fontSize: 18 }}>login</span>
                  Masuk
                </>
              )}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "var(--on-surface-variant)", marginTop: 20 }}>
          QA Buddy v0.7.0 · BRI/BFLP Internal Tool
        </p>
      </div>
    </div>
  );
}
