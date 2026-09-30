import { FormEvent, useState } from "react";
import { GasPump } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const addr = email.trim().toLowerCase();
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
      if (error) setMsg({ kind: "err", text: error.message.includes("confirm") ? "Confirm your email first. Check your inbox for the link." : "Wrong email or password." });
    } else {
      const { data, error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: window.location.origin } });
      if (error) {
        setMsg({ kind: "err", text: /database|invited/i.test(error.message) ? "That email isn't invited yet. Ask Bennett to add it." : error.message });
      } else if (!data.session) {
        setMsg({ kind: "ok", text: "Check your email and tap the confirm link, then come back here and sign in." });
        setMode("in");
      }
    }
    setBusy(false);
  }

  return (
    <div className="screen" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <div className="nb lg accent" aria-hidden><GasPump size={30} weight="fill" /></div>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>FillSmart</h1>
        <p className="hint" style={{ textAlign: "center" }}>Local gas prices, pump scans and fuel spend. Invite only for now.</p>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="sunk field">
          <label htmlFor="em">Email</label>
          <input id="em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ fontWeight: 600 }} />
        </div>
        <div className="sunk field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} style={{ fontWeight: 600 }} />
        </div>
        {msg && <p className={msg.kind} role="status">{msg.text}</p>}
        <button className="pillbtn accent" type="submit" disabled={busy}>{busy ? "One moment" : mode === "in" ? "Sign in" : "Create account"}</button>
        <button type="button" className="linkbtn" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
          {mode === "in" ? "First time? Create your account" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
