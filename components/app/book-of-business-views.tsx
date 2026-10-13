"use client";

/**
 * Two small pieces the Book of Business screens share (statements, discrepancies, the commission
 * ledger, sales performance and the daily deal flow), drawn as the Agent Floor and the transfer
 * inbox draw them (2026-10-06 redesign):
 *
 *   ViewTabs            the segmented views under a page's title, each with its count. A tab is a
 *                       button, or a link when the view lives in the URL (a server page).
 *   useFittingPageSize  rows per page that fit the window under the page's own chrome, so the pager
 *                       sits at the bottom of the screen rather than a scroll away.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type ViewTab<K extends string> = { key: K; label: string; count?: number; href?: string };

const tabClass = (active: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold tracking-[-0.01em] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
  );

export function ViewTabs<K extends string>({ label, tabs, active, onChange, controls }: {
  label: string;
  tabs: Array<ViewTab<K>>;
  active: K;
  onChange?: (key: K) => void;
  /** The id of the panel the tabs switch, when there is one. */
  controls?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex h-9 w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        const inner = (
          <>
            {tab.label}
            {tab.count !== undefined && <span className="rounded-full bg-[var(--surface-alt)] px-1.5 text-xs tabular-nums text-muted-foreground">{tab.count.toLocaleString("en-US")}</span>}
          </>
        );
        return tab.href ? (
          <Link key={tab.key} role="tab" aria-selected={selected} aria-controls={controls} href={tab.href} className={tabClass(selected)}>{inner}</Link>
        ) : (
          <button key={tab.key} id={controls ? `${controls}-tab-${tab.key}` : undefined} type="button" role="tab" aria-selected={selected} aria-controls={controls} onClick={() => onChange?.(tab.key)} className={tabClass(selected)}>{inner}</button>
        );
      })}
    </div>
  );
}

/**
 * Rows per page: as many as fit the window under `reserved` pixels of chrome, between 5 and 50.
 * Recomputed when the window is resized; 10 until the browser has measured.
 */
export function useFittingPageSize(reserved: number, rowHeight: number) {
  const [size, setSize] = useState(10);
  useEffect(() => {
    const fit = () => setSize(Math.min(10, Math.max(5, Math.floor((window.innerHeight - reserved) / rowHeight))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [reserved, rowHeight]);
  return size;
}
