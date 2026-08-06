import React, { useState } from "react";
import logo from "../assets/logo.png";

const ROLES = [
  "Team Leader",
  "Tester Leader",
  "Product Tester",
  "Technical Writer",
  "Admin",
] as const;

interface Props {
  onLogin: (username: string, role: string, jiraApiToken: string, confluenceApiToken: string) => void;
}

type Mode = "login" | "register";

export default function Login({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>("login");

  // Login fields
  const [pn, setPn] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Register fields
  const [regPn, setRegPn] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regRole, setRegRole] = useState<string>("");
  const [showRegPassword, setShowRegPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setSuccess(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await window.qaBuddy.loginUser(pn.trim(), password);
      if (result.success) {
        onLogin(pn.trim(), result.role ?? "", result.jira_api_token ?? "", result.confluence_api_token ?? "");
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err?.message || "Terjadi kesalahan. Pastikan database terhubung.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!regRole) {
      setError("Pilih role terlebih dahulu.");
      return;
    }
    if (regPassword !== regConfirm) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }

    setLoading(true);
    try {
      const result = await window.qaBuddy.registerUser(regPn.trim(), regPassword, regRole);
      if (result.success) {
        setSuccess("Registrasi berhasil! Silakan masuk dengan akun Anda.");
        setRegPn(""); setRegPassword(""); setRegConfirm(""); setRegRole("");
        setTimeout(() => switchMode("login"), 1500);
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err?.message || "Terjadi kesalahan. Pastikan database terhubung.");
    } finally {
      setLoading(false);
    }
  };

  const iconStyle: React.CSSProperties = {
    position: "absolute",
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 18,
    color: "var(--on-surface-variant)",
    pointerEvents: "none",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "0 24px" }}>
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img src={logo} alt="QA Buddy" style={{ width: 56, height: 56, marginBottom: 14 }} />
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: "var(--on-surface)" }}>QA Buddy</h1>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid var(--outline-variant)", marginBottom: 20 }}>
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{
                flex: 1,
                padding: "10px 0",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: mode === m ? 600 : 400,
                background: mode === m ? "var(--primary)" : "var(--surface-container)",
                color: mode === m ? "var(--on-primary)" : "var(--on-surface-variant)",
                transition: "background 0.15s",
              }}
            >
              {m === "login" ? "Masuk" : "Daftar"}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="card" style={{ padding: "28px 28px 24px", borderRadius: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 20px", color: "var(--on-surface)" }}>
            {mode === "login" ? "Masuk ke akun Anda" : "Buat akun baru"}
          </h2>

          {/* ── LOGIN FORM ── */}
          {mode === "login" && (
            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 500 }}>PN (Employee ID)</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols" style={iconStyle}>badge</span>
                  <input
                    type="text"
                    value={pn}
                    onChange={(e) => { setPn(e.target.value); setError(null); }}
                    placeholder="e.g. 00400291"
                    autoComplete="username"
                    autoFocus
                    required
                    style={{ paddingLeft: 40, width: "100%" }}
                  />
                </div>
              </div>

              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 500 }}>Password</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols" style={iconStyle}>lock</span>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                    style={{ paddingLeft: 40, paddingRight: 44, width: "100%" }}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)", padding: 4, display: "flex", alignItems: "center" }}>
                    <span className="material-symbols" style={{ fontSize: 18 }}>{showPassword ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </div>

              {error && <ErrorBox message={error} />}

              <button type="submit" className="primary-button" disabled={loading}
                style={{ width: "100%", height: 44, fontSize: 15, borderRadius: 10, marginTop: 4 }}>
                {loading
                  ? <><span className="material-symbols" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>progress_activity</span>Masuk...</>
                  : <><span className="material-symbols" style={{ fontSize: 18 }}>login</span>Masuk</>}
              </button>
            </form>
          )}

          {/* ── REGISTER FORM ── */}
          {mode === "register" && (
            <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 500 }}>PN (Employee ID)</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols" style={iconStyle}>badge</span>
                  <input
                    type="text"
                    value={regPn}
                    onChange={(e) => { setRegPn(e.target.value); setError(null); }}
                    placeholder="e.g. 00400291"
                    autoFocus
                    required
                    style={{ paddingLeft: 40, width: "100%" }}
                  />
                </div>
              </div>

              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 500 }}>Role</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols" style={iconStyle}>manage_accounts</span>
                  <select
                    value={regRole}
                    onChange={(e) => { setRegRole(e.target.value); setError(null); }}
                    required
                    style={{ paddingLeft: 40, width: "100%", appearance: "none" }}
                  >
                    <option value="">-- Pilih Role --</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 500 }}>Password</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols" style={iconStyle}>lock</span>
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => { setRegPassword(e.target.value); setError(null); }}
                    placeholder="Minimal 6 karakter"
                    required
                    style={{ paddingLeft: 40, paddingRight: 44, width: "100%" }}
                  />
                  <button type="button" onClick={() => setShowRegPassword((v) => !v)} tabIndex={-1}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)", padding: 4, display: "flex", alignItems: "center" }}>
                    <span className="material-symbols" style={{ fontSize: 18 }}>{showRegPassword ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </div>

              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 500 }}>Konfirmasi Password</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols" style={iconStyle}>lock_reset</span>
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regConfirm}
                    onChange={(e) => { setRegConfirm(e.target.value); setError(null); }}
                    placeholder="Ulangi password"
                    required
                    style={{ paddingLeft: 40, width: "100%" }}
                  />
                </div>
              </div>

              {error && <ErrorBox message={error} />}
              {success && (
                <div style={{ fontSize: 13, color: "var(--primary)", background: "rgba(var(--primary-rgb), 0.08)", border: "1px solid rgba(var(--primary-rgb), 0.25)", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="material-symbols" style={{ fontSize: 16, flexShrink: 0 }}>check_circle</span>
                  {success}
                </div>
              )}

              <button type="submit" className="primary-button" disabled={loading}
                style={{ width: "100%", height: 44, fontSize: 15, borderRadius: 10, marginTop: 4 }}>
                {loading
                  ? <><span className="material-symbols" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>progress_activity</span>Mendaftar...</>
                  : <><span className="material-symbols" style={{ fontSize: 18 }}>person_add</span>Daftar</>}
              </button>
            </form>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "var(--on-surface-variant)", marginTop: 20 }}>
          QA Buddy v0.7.0 · For BRI Internal Use Only
        </p>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ fontSize: 13, color: "var(--error)", background: "rgba(var(--error-rgb, 220,38,38), 0.08)", border: "1px solid rgba(var(--error-rgb, 220,38,38), 0.25)", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
      <span className="material-symbols" style={{ fontSize: 16, flexShrink: 0 }}>error</span>
      {message}
    </div>
  );
}
