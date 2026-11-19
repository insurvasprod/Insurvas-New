"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Lockout = { email: string; locked_until: string | null };

/**
 * Under the Login protection settings on Platform › Advanced: how many accounts are locked right now, and a link to
 * Monitoring › Lockouts, where the list and Unlock moved (admin round 1, docs/design/admin-r1/monitoring.html
 * screen 3). Same read as before (GET /api/admin/security/rate-limits, super admin only), fetched after mount.
 */
export function LoginProtectionPanel() {
  const [locked, setLocked] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/security/rate-limits", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { lockouts?: Lockout[] } | null;
        if (cancelled) return;
        if (!response.ok || !body) return setFailed(true);
        const emails = new Set((body.lockouts ?? []).filter((entry) => entry.locked_until).map((entry) => entry.email.toLowerCase()));
        setLocked(emails.size);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground" role="status">
      <span className="text-foreground">
        {failed ? "Lockouts could not be read" : locked === null ? "Counting lockouts" : `${locked.toLocaleString("en-US")} ${locked === 1 ? "account" : "accounts"} locked`}
      </span>
      <span aria-hidden="true">·</span>
      <Link href="/admin/monitoring/lockouts" className="font-medium text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]">
        Open Lockouts
      </Link>
    </p>
  );
}
