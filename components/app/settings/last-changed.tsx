"use client";

import { useEffect, useState } from "react";

import { actorLine, type SettingsAuditEntry } from "@/lib/settingsAudit/constants";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { peek, readResource, seed } from "@/lib/client/resource-cache";

type LastBody = { last?: SettingsAuditEntry | null } | null;
/** A section's last change, as the app's cache keys it (lib/client/resource-cache.ts). */
const lastChangedKey = (sectionKey: string) => `/api/app/settings-audit/last?section=${encodeURIComponent(sectionKey)}`;

/**
 * LA-8.8 · "Last changed by Umar Masood (owner) on 3 Oct, 14:22 — History", under a settings
 * section's title. Only for the account owner, who can open the log it links into. Says nothing when
 * nothing in the section has been changed, or before the log exists.
 */
export function SectionLastChanged({ sectionKey }: { sectionKey: string }) {
  const [last, setLast] = useState<SettingsAuditEntry | null>(() => seed<LastBody>(lastChangedKey(sectionKey))?.data?.last ?? null);

  useEffect(() => {
    // The header remounts with its section (the panel is keyed by it): nothing to reset first.
    let live = true;
    const kept = peek<LastBody>(lastChangedKey(sectionKey))?.data;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.last) setLast((current) => current ?? kept.last ?? null);
    // Through the app's cache (lib/client/resource-cache.ts); a kept answer is shown while this asks again.
    readResource<LastBody>(lastChangedKey(sectionKey))
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
