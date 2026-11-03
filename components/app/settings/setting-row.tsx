"use client";

/**
 * The plain-language rows of the Money & compliance settings (Accounting, Retention, Compliance;
 * owner pick A, 2026-11-03, docs/settings/MONEY-COMPLIANCE-SETTINGS.md).
 *
 *   <SettingRow>     a setting's name on the left, its control on the right, and under the control
 *                    what the setting changes. That line stays on screen: it says what an edit will
 *                    do (UI-CONSISTENCY §15), which is why these pages exist.
 *   <LockedNote>     a safety limit, beside the setting it guards, with the lock.
 *   <SectionTabs>    the page's tabs on the Settings frame's title line; a link to a section's
 *                    anchor (#tax) opens the tab that holds it.
 */

import { useEffect, type ReactNode } from "react";

import { LockIcon, SettingsSectionHeader } from "@/components/app/settings/primitives";
import { ViewTabs, type ViewTab } from "@/components/ui/view-tabs";
import { cn } from "@/lib/utils";

export function SettingRow({ id, label, sub, change, platform, children, className }: {
  id?: string;
  label: ReactNode;
  /** One short qualifier under the name ("Optional", "Only with a capped share"). */
  sub?: ReactNode;
  /** What the setting changes, in a sentence. */
  change?: ReactNode;
  /** Insurvas's value, shown only when the agency's differs from it. */
  platform?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div id={id} className={cn("grid min-w-0 scroll-mt-24 gap-x-6 gap-y-2 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0 @3xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]", className)}>
      <div className="min-w-0">
        <p className="m-0 text-sm font-medium text-[var(--ink)]">{label}</p>
        {sub && <p className="m-0 text-xs text-[var(--muted)]">{sub}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {children}
        {change && <p className="m-0 max-w-[68ch] text-sm text-[var(--body)]"><span className="text-[var(--muted)]">What this changes: </span>{change}</p>}
        {platform != null && <p className="m-0 text-xs text-[var(--muted)]">Insurvas: {platform}</p>}
      </div>
    </div>
  );
}

export function LockedNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-1.5 text-sm text-[var(--muted)]">
      <span className="mt-0.5 shrink-0"><LockIcon /></span>
      <span>{children}</span>
    </p>
  );
}

/** The tab a page opens on, and the tab each anchor lives in. */
export function useAnchorTab<T extends string>(anchors: Readonly<Record<string, T>>, setTab: (tab: T) => void) {
  useEffect(() => {
    const follow = () => {
      const anchor = window.location.hash.replace(/^#/, "").split("/").pop() ?? "";
      const tab = anchors[anchor] ?? (Object.values(anchors) as string[]).find((t) => t === anchor);
      if (!tab) return;
      setTab(tab as T);
      // Once the tab has drawn (a board that loads its data draws it later): open an Advanced fold
      // that holds the anchor, then bring it into view.
      let tries = 0;
      const reveal = () => {
        const target = document.getElementById(anchor);
        if (!target) { if (++tries < 30) window.setTimeout(reveal, 100); return; }
        const fold = target.closest("details");
        if (fold) fold.open = true;
        target.scrollIntoView({ block: "start" });
      };
      window.setTimeout(reveal, 60);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [anchors, setTab]);
}

export function SectionTabs<T extends string>({ label, tabs, value, onChange, actions }: {
  label: string;
  tabs: ViewTab<T>[];
  value: T;
  onChange: (tab: T) => void;
  /** At most two buttons, the More menu first (UI-CONSISTENCY §2). */
  actions?: ReactNode;
}) {
  return <SettingsSectionHeader lead={<ViewTabs label={label} tabs={tabs} value={value} onChange={onChange} />} actions={actions} />;
}
