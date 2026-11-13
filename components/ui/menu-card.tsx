"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export type MenuCardItem = {
  key: string;
  label: string;
  href: string;
  active?: boolean;
  /** Its own state, drawn as a ring before the label: done (green tick), current (accent ring), todo (empty). */
  state?: "done" | "current" | "todo" | "paused";
  /** After the label, right-aligned: minutes, a count. */
  trailing?: ReactNode;
};

export type MenuCardGroup = {
  key: string;
  label: string;
  /** Drawn in the group's badge (a chapter number); a tick replaces it once every item is done. */
  number?: number;
  /** "2 / 4" beside the name, and the badge's tick at the end. */
  progress?: { done: number; total: number };
  /** Small chip after the name (Required, Optional). */
  aside?: ReactNode;
  /** Sub-headings inside the group: items are listed under the heading whose key they carry. */
  sections?: { key: string; label: string }[];
  items: (MenuCardItem & { section?: string })[];
};

function Ring({ state }: { state?: MenuCardItem["state"] }) {
  if (!state) return null;
  return (
    <span aria-hidden="true" className={cn(
      "inline-flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
      state === "done" && "border-transparent bg-[var(--success)] text-[var(--on-success)]",
      state === "current" && "border-[var(--primary)] bg-[var(--primary-soft)]",
      state === "paused" && "border-[var(--warning)]",
      state === "todo" && "border-[var(--border-strong)]",
    )}>
      {state === "done" ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
    </span>
  );
}

/**
 * A page's own menu (Docs and Get set up, R4 rework, owner 2026-11-13: "it's so smushed together and hard to
 * differentiate pages"). Groups are clearly apart: each has a numbered badge, its name, its progress and a chevron,
 * and opens to its pages, indented on a guide line with a state ring each and titles that wrap instead of cutting
 * off. Only the group you are in opens on arrival; any other opens on a click. A filter at the top opens every group
 * that matches; the foot holds a line of progress.
 */
export function MenuCard({ groups, top, header, footer, filterPlaceholder, label, className, openAll = false }: {
  groups: MenuCardGroup[];
  /** Items above the first group (Docs' "Start here"). */
  top?: MenuCardItem[];
  /** Above the filter: a title and a progress line. */
  header?: ReactNode;
  footer?: ReactNode;
  filterPlaceholder?: string;
  label: string;
  className?: string;
  /** Every group open (a short menu such as Get set up's). */
  openAll?: boolean;
}) {
  const [query, setQuery] = useState("");
  const activeGroup = groups.find((group) => group.items.some((item) => item.active))?.key ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(openAll ? groups.map((group) => group.key) : activeGroup ? [activeGroup] : []));
  const words = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!words) return groups;
    return groups
      .map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(words) || group.label.toLowerCase().includes(words)) }))
      .filter((group) => group.items.length > 0);
  }, [groups, words]);
  const toggle = (key: string) => setOpen((now) => { const next = new Set(now); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const link = (item: MenuCardItem, nested: boolean) => (
    <Link
      key={item.key}
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      className={cn(
        "relative flex min-h-[32px] w-full items-start gap-2.5 rounded-[8px] py-1.5 pr-2 text-left text-sm leading-snug no-underline transition-colors",
        nested ? "pl-3" : "pl-2.5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
        item.active ? "bg-[var(--primary-soft)] font-semibold text-[var(--ink)]" : "text-[var(--body)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]",
      )}
    >
      {item.active && nested ? <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 -left-[13px] w-0.5 rounded-full bg-[var(--primary)]" /> : null}
      {item.state ? <span className="mt-0.5"><Ring state={item.state} /></span> : null}
      <span className="min-w-0 flex-1">{item.label}</span>
      {item.trailing ? <span className="mt-0.5 shrink-0 text-xs tabular-nums text-[var(--muted)]">{item.trailing}</span> : null}
    </Link>
  );

  return (
    <nav aria-label={label} className={cn("flex min-h-0 flex-col rounded-[14px] border border-[var(--border)] bg-[var(--surface)]", className)}>
      {header ? <div className="shrink-0 border-b border-[var(--border)] px-4 pt-3.5 pb-3">{header}</div> : null}
      {filterPlaceholder ? (
        <label className="relative mx-3 mt-3 block shrink-0">
          <span className="sr-only">{filterPlaceholder}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={filterPlaceholder}
            autoComplete="off"
            className="h-9 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] pr-3 pl-9 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus-visible:border-[var(--primary)] [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-2">
        {top?.length ? <div className="mb-1 flex flex-col">{top.map((item) => link(item, false))}</div> : null}
        <div className="flex flex-col gap-1">
          {shown.map((group) => {
            const isOpen = words ? true : open.has(group.key);
            const complete = group.progress ? group.progress.total > 0 && group.progress.done >= group.progress.total : false;
            const here = group.key === activeGroup;
            const bodyId = `menu-${label.replace(/\W+/g, "-")}-${group.key}`;
            const sections = group.sections ?? [{ key: "", label: "" }];
            return (
              <section key={group.key} className={cn("rounded-[10px]", here && !isOpen && "bg-[var(--surface-alt)]")}>
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
                >
                  {group.number !== undefined ? (
                    <span aria-hidden="true" className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-xs font-semibold tabular-nums",
                      complete ? "bg-[var(--success-surface)] text-[var(--success)]" : here ? "bg-[var(--primary)] text-primary-foreground" : "bg-[var(--surface-alt)] text-[var(--muted)]",
                    )}>
                      {complete ? <Check className="size-3.5" strokeWidth={3} /> : group.number}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-[var(--ink)]">{group.label}</span>
                  {group.aside}
                  {group.progress ? <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{group.progress.done}/{group.progress.total}</span> : null}
                  <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--muted)] transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen ? (
                  <div id={bodyId} className={cn("mb-1.5 flex flex-col", group.number !== undefined && "ml-[19px] border-l border-[var(--border)] pl-[9px]")}>
                    {sections.map((section) => {
                      const items = group.items.filter((item) => (section.key ? item.section === section.key : true));
                      if (items.length === 0) return null;
                      return (
                        <div key={section.key || "all"} className="flex flex-col">
                          {section.label ? <p className="m-0 px-3 pt-2 pb-1 text-xs font-semibold text-[var(--muted)]">{section.label}</p> : null}
                          {items.map((item) => link(item, group.number !== undefined))}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
          {shown.length === 0 ? <p className="m-0 px-2.5 py-2 text-sm text-[var(--muted)]">Nothing matches &ldquo;{query.trim()}&rdquo;.</p> : null}
        </div>
      </div>
      {footer ? <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">{footer}</div> : null}
    </nav>
  );
}
