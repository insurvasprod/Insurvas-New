"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { PageHeader } from "@/components/ui/page-header";

/**
 * Puts a view's own controls into the Reports frame's top row (components/app/reports/reports-page.tsx),
 * level with the rail's top: its tabs or period on the left (`lead`), its page actions in the corner
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
 */
const TitleContext = createContext<((title: string | null) => void) | null>(null);

export function ReportsHeader({ title, children }: { title: string; children: ReactNode }) {
  const [own, setOwn] = useState<string | null>(null);
  return (
    <TitleContext.Provider value={setOwn}>
      <PageHeader title={own ?? title} className="lg:col-span-2 lg:pb-6" />
      {children}
    </TitleContext.Provider>
  );
}

/** Name the frame's title after what this view has open; back to the view's name when it unmounts. */
export function useReportsTitle(title: string | null) {
  const set = useContext(TitleContext);
  useEffect(() => {
    if (!set) return;
    set(title);
    return () => set(null);
  }, [set, title]);
}
