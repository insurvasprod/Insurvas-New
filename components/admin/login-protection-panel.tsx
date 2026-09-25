"use client";

import { useEffect, useState } from "react";
import { Unlock } from "lucide-react";
import { notify } from "@/lib/notify";

import { Pill, SettingsTableCard, btn, st } from "@/components/app/settings/primitives";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";

type Lockout = {
  scope_key: string;
  actor_type: "admin" | "user";
  email: string;
  ip: string;
  failed_attempts: number;
  last_failed_at: string;
  locked_until: string | null;
};

/**
 * Current login lockouts, and the super-admin unlock. Sits under the Login protection card on
 * Advanced; the rows are fetched after mount, so the local-time hover cannot mismatch hydration.
 */
export function LoginProtectionPanel() {
  const [lockouts, setLockouts] = useState<Lockout[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/security/rate-limits", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok) setLockouts(body?.lockouts ?? []);
        else notify.fail(body?.error ?? "Could not load login protection state");
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          notify.fail("Could not load login protection state");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function unlock(scopeKey: string) {
    setBusy(scopeKey);
    const response = await fetch("/api/admin/security/rate-limits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeKey }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(null);
    if (!response || !response.ok) {
      notify.block(body?.error ?? "Could not clear login lockout");
      return;
    }
    setLockouts((current) => current.filter((entry) => entry.scope_key !== scopeKey));
    notify.done("Login lockout cleared and recorded in the audit log");
  }

  const locked = lockouts.filter((entry) => entry.locked_until).length;

  return (
    <SettingsTableCard
      title="Login lockouts"
      actions={!loading && <Pill tone={locked > 0 ? "error" : "neutral"}>{locked} locked</Pill>}
    >
      {loading ? (
        <p role="status" className="m-0 px-4 py-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
          Loading current lockouts…
        </p>
      ) : lockouts.length === 0 ? (
        <p className="m-0 px-4 py-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No recorded login lockouts.</p>
      ) : (
        <table className={`${st.table} min-w-[640px]`}>
          <caption className="sr-only">Current login lockouts</caption>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Account</th>
              <th scope="col" className={st.th}>Plane</th>
              <th scope="col" className={st.th}>IP</th>
              <th scope="col" className={`${st.th} ${st.num}`}>Failures</th>
              <th scope="col" className={st.th}>Locked until</th>
              <th scope="col" className={st.th}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {lockouts.map((entry) => (
              <tr key={entry.scope_key}>
                <td className={`${st.td} ${st.strong}`}>{entry.email}</td>
                <td className={`${st.td} capitalize`}>{entry.actor_type}</td>
                <td className={st.td}><span className={st.code}>{entry.ip}</span></td>
                <td className={`${st.td} ${st.num}`}>{entry.failed_attempts}</td>
                <td className={st.td}>
                  {entry.locked_until ? (
                    <span title={new Date(entry.locked_until).toLocaleString()}>{formatUtcDateTime(entry.locked_until)}</span>
                  ) : (
                    "Not locked"
                  )}
                </td>
                <td className={`${st.td} text-right`}>
                  <button
                    type="button"
                    className={btn("row")}
                    onClick={() => void unlock(entry.scope_key)}
                    disabled={busy === entry.scope_key}
                  >
                    <Unlock className="size-3.5" aria-hidden="true" />
                    {busy === entry.scope_key ? "Clearing…" : "Clear lockout"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--body)]">
        Failed-login limits are persistent across restarts. Clear a lockout only after confirming the account owner.
      </div>
    </SettingsTableCard>
  );
}
