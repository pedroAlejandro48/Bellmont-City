import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Account } from "@/platform/account";
import { enablePush, pushPermission, registerDevice } from "@/platform/push";
import { inApp, installed } from "@/components/InstallApp";

const SNOOZE = "bellmont-push-later";
const ASKED = "bellmont-push-asked";
const asked = () => { try { return localStorage.getItem(ASKED) === "1"; } catch { return true; } };
const snoozed = () => { try { return Date.now() < Number(localStorage.getItem(SNOOZE) ?? 0); } catch { return false; } };

/**
 * Notifications: in the installed app, if they haven't been allowed or refused yet, a card asks (the browser's own
 * question needs a tap); "Not now" waits a week.
 */
export function PushPrompt({ account }: { account: Account }) {
  const [, tick] = useState(0);
  const perm = pushPermission();
  // Allowed: this device is registered for notifications that reach it even with the game closed.
  useEffect(() => { if (perm === "granted") void registerDevice(); }, [account, perm]);
  // The Android app, opened for the first time: ask straight away (Android shows its own Allow question).
  useEffect(() => {
    if (perm !== "default" || !inApp() || asked()) return;
    try { localStorage.setItem(ASKED, "1"); } catch { /* */ }
    void enablePush().then(() => tick((n) => n + 1));
  }, [perm]);
  if (perm !== "default" || !installed() || snoozed()) return null;
  return <div className="push-prompt hud-panel">
    <Bell size={18} aria-hidden />
    <span>Get notified when friends add you, accept you or invite you to a room.</span>
    <div className="flex gap-2">
      <Button type="button" size="sm" onClick={() => void enablePush().then(() => tick((n) => n + 1))}>Allow</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => { try { localStorage.setItem(SNOOZE, String(Date.now() + 7 * 864e5)); } catch { /* */ } tick((n) => n + 1); }}>Not now</Button>
    </div>
  </div>;
}
