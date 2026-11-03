"use client";

import { useEffect, useState } from "react";

import { actorLine, type SettingsAuditEntry } from "@/lib/settingsAudit/constants";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";

/**
 * LA-8.8 · "Last changed by Umar Masood (owner) on 3 Oct, 14:22 — History", under a settings
 * section's title. Only for the account owner, who can open the log it links into. Says nothing when
 * nothing in the section has been changed, or before the log exists.
 */
export function SectionLastChanged({ sectionKey }: { sectionKey: string }) {
  const [last, setLast] = useState<SettingsAuditEntry | null>(null);

  useEffect(() => {
    // The header remounts with its section (the panel is keyed by it): nothing to reset first.
    let live = true;
    fetch(`/api/app/settings-audit/last?section=${encodeURIComponent(sectionKey)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (live) setLast(body?.last ?? null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [sectionKey]);

  if (!last) return null;
  return (
    <p className="mt-1 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
      Last changed by {actorLine(last)} on {dateTime(last.occurredAt, viewerTimeZone())} ·{" "}
      <a className="font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/settings?history=${encodeURIComponent(sectionKey)}#settings-history`}>History</a>
    </p>
  );
}
