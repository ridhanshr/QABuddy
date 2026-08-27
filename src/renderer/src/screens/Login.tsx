import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
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

const inputBase =
  "w-full rounded-lg border border-line bg-card py-2.5 text-sm text-ink outline-none transition placeholder:text-faint focus:border-primary";

const fieldLabel = "mb-1.5 block text-xs font-semibold text-muted";

function FieldIcon({ children }: { children: string }) {
  return (
    <span className="material-symbols pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 !text-[18px] text-faint">
      {children}
    </span>
  );
}

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
  const [appVersion, setAppVersion] = useState("...");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("1.0.0"));
  }, []);

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 font-sans">
      <div className="w-full max-w-[400px]">
        {/* Brand */}
        <div className="mb-7 text-center">
          <img src={logo} alt="QA Buddy" className="mx-auto mb-3 h-[52px] w-[52px]" />
          <h1 className="text-[22px] font-bold tracking-tight text-ink">QA Buddy</h1>
          <p className="mt-0.5 text-xs text-muted">Buddy Up. Test Smarter.</p>
        </div>

        {/* Tab switcher */}
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-low p-1">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={
                mode === m
                  ? "rounded-lg bg-card py-2 text-[13px] font-semibold text-ink shadow-sm"
                  : "rounded-lg py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
              }
            >
              {m === "login" ? "Masuk" : "Daftar"}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-line bg-card p-6">
          <h2 className="mb-4 text-[17px] font-semibold text-ink">
            {mode === "login" ? "Masuk ke akun Anda" : "Buat akun baru"}
          </h2>

          {/* ── LOGIN FORM ── */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <label className="block">
                <span className={fieldLabel}>PN (Employee ID)</span>
                <div className="relative">
                  <FieldIcon>badge</FieldIcon>
                  <input
                    type="text"
                    value={pn}
                    onChange={(e) => { setPn(e.target.value); setError(null); }}
                    placeholder="e.g. 00400291"
                    autoComplete="username"
                    autoFocus
                    required
                    className={`${inputBase} pl-10`}
                  />
                </div>
              </label>

              <label className="block">
                <span className={fieldLabel}>Password</span>
                <div className="relative">
                  <FieldIcon>lock</FieldIcon>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                    className={`${inputBase} pl-10 pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-surface-mid"
                  >
                    <span className="material-symbols !text-[18px]">{showPassword ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </label>

              {error && <ErrorBox message={error} />}

              <SubmitButton loading={loading} label={loading ? "Masuk..." : "Masuk"} icon={loading ? "" : "login"} />
            </form>
          )}

          {/* ── REGISTER FORM ── */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <label className="block">
                <span className={fieldLabel}>PN (Employee ID)</span>
                <div className="relative">
                  <FieldIcon>badge</FieldIcon>
                  <input
                    type="text"
                    value={regPn}
                    onChange={(e) => { setRegPn(e.target.value); setError(null); }}
                    placeholder="e.g. 00400291"
                    autoFocus
                    required
                    className={`${inputBase} pl-10`}
                  />
                </div>
              </label>

              <label className="block">
                <span className={fieldLabel}>Role</span>
                <div className="relative">
                  <FieldIcon>manage_accounts</FieldIcon>
                  <select
                    value={regRole}
                    onChange={(e) => { setRegRole(e.target.value); setError(null); }}
                    required
                    className={`${inputBase} appearance-none pl-10 pr-9`}
                  >
                    <option value="">-- Pilih Role --</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </label>

              <label className="block">
                <span className={fieldLabel}>Password</span>
                <div className="relative">
                  <FieldIcon>lock</FieldIcon>
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => { setRegPassword(e.target.value); setError(null); }}
                    placeholder="Minimal 6 karakter"
                    required
                    className={`${inputBase} pl-10 pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-surface-mid"
                  >
                    <span className="material-symbols !text-[18px]">{showRegPassword ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </label>

              <label className="block">
                <span className={fieldLabel}>Konfirmasi Password</span>
                <div className="relative">
                  <FieldIcon>lock_reset</FieldIcon>
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regConfirm}
                    onChange={(e) => { setRegConfirm(e.target.value); setError(null); }}
                    placeholder="Ulangi password"
                    required
                    className={`${inputBase} pl-10`}
                  />
                </div>
              </label>

              {error && <ErrorBox message={error} />}
              {success && (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px]"
                  style={{
                    color: "var(--success)",
                    background: "var(--success-container)",
                    borderColor: "color-mix(in srgb, var(--success) 30%, transparent)",
                  }}
                >
                  <span className="material-symbols !flex-shrink-0 !text-[16px]">check_circle</span>
                  {success}
                </div>
              )}

              <SubmitButton loading={loading} label={loading ? "Mendaftar..." : "Daftar"} icon={loading ? "" : "person_add"} />
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-faint">
          QA Buddy v{appVersion} · For BRI Internal Use Only
        </p>
      </div>
    </div>
  );
}

function SubmitButton({ loading, label, icon }: { loading: boolean; label: string; icon: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-55"
    >
      {loading ? (
        <span className="material-symbols spin !text-[18px]">progress_activity</span>
      ) : (
        <span className="material-symbols !text-[18px]">{icon}</span>
      )}
      {label}
    </button>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px]"
      style={{
        color: "var(--error)",
        background: "var(--error-container)",
        borderColor: "color-mix(in srgb, var(--error) 30%, transparent)",
      }}
    >
      <span className="material-symbols !flex-shrink-0 !text-[16px]">error</span>
      {message}
    </div>
  );
}
