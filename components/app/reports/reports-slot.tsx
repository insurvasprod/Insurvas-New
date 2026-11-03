"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";

import { InfoTip } from "@/components/ui/info-tip";
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Puts a view's own controls into the Reports frame's top row (components/app/reports/reports-page.tsx),
 * level with the rail's top: its tabs on the left (`lead`), its page actions in the corner
 * (`corner`). Outside the frame this renders nothing, so a view keeps its own controls there.
 */
export function ReportsSlot({ slot, children }: { slot: "lead" | "corner"; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // The slot is server-rendered beside this component, so it exists once we are mounted.
  useEffect(() => { setTarget(document.getElementById(`reports-${slot}`)); }, [slot]); // eslint-disable-line react-hooks/set-state-in-effect
  return target ? createPortal(children, target) : null;
}

/** A view's own controls: in the frame's slot when framed, where they were otherwise. */
export function InReportsSlot({ framed, slot, children }: { framed: boolean; slot: "lead" | "corner"; children: ReactNode }) {
  return framed ? <ReportsSlot slot={slot}>{children}</ReportsSlot> : <>{children}</>;
}

/**
 * The frame's title: the view's name, or the record a view has open (a partner's name), which the view
 * names once its data is in (`useReportsTitle`). The trail follows from the menu (PageTrail).
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md), as Accounting: a record's header is the
 * title, its status chip and one muted line of facts. A server page passes them (`chip`, `facts`); a
 * client view that only knows them once its data is in names them with `useReportsTitle`.
 */
type Own = { title: string | null; facts?: ReactNode; chip?: ReactNode };
const TitleContext = createContext<((own: Own) => void) | null>(null);

export function ReportsHeader({ title, info, chip, facts, children }: { title: string; info?: ReactNode; chip?: ReactNode; facts?: ReactNode; children: ReactNode }) {
  const [own, setOwn] = useState<Own>({ title: null });
  const shownTitle = own.title ?? title;
  const shownChip = own.chip ?? chip;
  const shownFacts = own.facts ?? facts;
  return (
    <TitleContext.Provider value={setOwn}>
      {/* The view's tabs and actions are on the title's line (owner 2026-11-02), so its first card starts
          level with the rail's top. */}
      <PageHeader
        title={shownTitle}
        titleInfo={info || shownChip ? <>{info ? <InfoTip label={`About ${shownTitle}`} side="right">{info}</InfoTip> : null}{shownChip}</> : undefined}
        // The facts never widen the title's column (it sizes to its content beside the tabs): they wrap in
        // it, at least 360px wide, so a long line cannot squeeze the tabs (the Accounting walk, 2026-11-03).
        meta={shownFacts ? <p className="mt-1 text-sm text-muted-foreground lg:min-w-[360px] lg:[contain:inline-size]">{shownFacts}</p> : undefined}
        lead={<div id="reports-lead" className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden" />}
        actions={<div id="reports-corner" className="flex items-center gap-2 empty:hidden" />}
        className="lg:col-span-2 lg:pb-6"
      />
      {children}
    </TitleContext.Provider>
  );
}

/**
 * Name the frame's title after what this view has open, with its facts line and chip; back to the
 * view's own when it unmounts.
 */
export function useReportsTitle(title: string | null, facts?: ReactNode, chip?: ReactNode) {
  const set = useContext(TitleContext);
  useEffect(() => {
    if (!set) return;
    set({ title, facts, chip });
    return () => set({ title: null });
  }, [set, title, facts, chip]);
}

/**
 * A client view's tab, kept in the address (`?tab=` by default) so a strip tile, the bell or a bookmark
 * lands on it and a reload keeps it. Changing it replaces the address in place (no server round trip);
 * the period and the other parameters stay. `href(tab)` is the address of a tab, for a tile's link.
 */
export function useUrlTab<K extends string>(keys: readonly K[], fallback: K, param = "tab", alias: Record<string, K> = {}) {
  const query = useSearchParams();
  const pathname = usePathname();
  const raw = query.get(param) ?? "";
  const fromUrl = (keys as readonly string[]).includes(raw) ? (raw as K) : alias[raw] ?? null;
  const [tab, setLocal] = useState<K>(fromUrl ?? fallback);
  // A link to another tab of this same page (a tile) changes the address; follow it.
  useEffect(() => { if (fromUrl && fromUrl !== tab) setLocal(fromUrl); }, [fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  const href = useCallback((next: K) => {
    const params = new URLSearchParams(query.toString());
    params.set(param, next);
    return `${pathname}?${params}`;
  }, [query, pathname, param]);
  const setTab = useCallback((next: K) => {
    setLocal(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(param, next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { /* the tab still changes */ }
  }, [param]);
  return useMemo(() => ({ tab, setTab, href }), [tab, setTab, href]);
}

/**
 * A view's first read inside the frame: a table skeleton in the step column. PageLoading would draw a
 * second trail and title under the frame's own.
 */
export function FramedLoading() {
  return <TableCard><SectionLoading rows={8} columns={6} /></TableCard>;
}
