import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Bellmont City — Reset password" },
      { name: "description", content: "Choose a new password for your Bellmont City account." },
      { property: "og:title", content: "Bellmont City — Reset password" },
      { property: "og:description", content: "Choose a new password for your Bellmont City account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The recovery link lands here with type=recovery in the URL hash; the
    // client exchanges it for a recovery session and fires PASSWORD_RECOVERY.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session && window.location.hash.includes("type=recovery")) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setMsg("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setMsg("Passwords do not match."); return; }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setMsg(error.message); return; }
      void navigate({ to: "/" });
    } catch {
      setMsg("Could not update your password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-center text-4xl tracking-tight text-foreground">Choose a new password</h1>
        <form onSubmit={submit} className="hud-panel mt-8 space-y-4 p-6">
          {ready ? (
            <>
              <input aria-label="New password" className="auth-input" type="password" autoComplete="new-password" required minLength={6} maxLength={256} placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <input aria-label="Confirm new password" className="auth-input" type="password" autoComplete="new-password" required minLength={6} maxLength={256} placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <Button disabled={busy} className="w-full">{busy ? "…" : "Save new password"}</Button>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Open this page from the reset link in your email. If the link expired, request a new one from the sign-in page.
            </p>
          )}
          {msg && <p role="alert" className="text-center text-sm text-accent">{msg}</p>}
          <Button type="button" variant="ghost" className="w-full" onClick={() => void navigate({ to: "/" })}>Back to sign in</Button>
        </form>
      </div>
    </div>
  );
}
