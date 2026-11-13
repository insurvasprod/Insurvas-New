"use client";

import Link from "next/link";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { cn } from "@/lib/utils";

/**
 * Settings › Money & compliance, round 8 (docs/design/settings-r8/money-compliance-settings.html, one design, owner
 * "Build all four" 2026-11-12). The one pattern Accounting, Retention and Compliance share:
 *
 *   - a setting is one line: Setting · Now (plain words) · Used by · Changed (who, gold avatar, and when) · one Value
 *     chip (Yours, Insurvas, Locked, Owner) · ›. A click anywhere on it opens its sheet.
 *   - the sheet, from the right, changes that one setting: its control, what it affects, its own history with
 *     "Put back", and Use Insurvas value · Cancel · Save this setting. Save keeps that setting only.
 *   - a locked row opens a sheet that says why, what it means day to day, who set it and who to ask.
 *   - a status line under the title, never a notice card: "Saved · … changed by Dana Ruiz on Nov 9".
 *
 * Built from components/ui (TableCard, Sheet, StatusChip, Button); nothing here draws its own surface.
 */

/* ── words ─────────────────────────────────────────────────────────────── */

/** "Dana Ruiz" as "DR"; Insurvas as "IN". */
export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
/** "Nov 9" this year, "Nov 9, 2025" before it. */
export function shortDay(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const thisYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
/** "Nov 9, 2026 at 4:12 PM", in the viewer's zone. */
export function longWhen(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
const titleWords = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
/**
 * A stored value in plain words, for a history line: money in dollars (a `_cents` column), a share as a percentage
 * (`_bp`), yes/no, a list by its items, nothing as "none". `field` is the column or setting name it came from.
 */
export function plainValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") {
    if (/cents$/i.test(field)) return (value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    if (/_?bp$/i.test(field)) return `${(value / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
    return value.toLocaleString("en-US");
  }
  if (Array.isArray(value)) return value.length ? value.map((v) => titleWords(String(v))).join(", ") : "none";
  if (typeof value === "object") return "changed";
  const text = String(value);
  return text.length > 40 ? `"${text.slice(0, 38)}…"` : /\s/.test(text) ? `"${text}"` : titleWords(text);
}

/* ── the status line ───────────────────────────────────────────────────── */

export type LineTone = "ok" | "warn" | "bad";

/** One line under the title: a dot for its tone and the words (foundation rule: a status line, not notices). */
export function StatusLine({ tone = "ok", children }: { tone?: LineTone; children: ReactNode }) {
  return (
    <p role="status" className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--muted)]">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone === "ok" && "bg-[var(--success)]", tone === "warn" && "bg-[var(--warning)]", tone === "bad" && "bg-[var(--error)]")} />
      {children}
    </p>
  );
}

/** A link inside the status line or a help line. */
export function LineLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  const look = "font-semibold text-[var(--accent-ink)] hover:underline";
  if (href) return <Link className={look} href={href}>{children}</Link>;
  return <button type="button" className={cn(look, "border-0 bg-transparent p-0")} onClick={onClick}>{children}</button>;
}

/* ── the row ───────────────────────────────────────────────────────────── */

/** A person: initials on the gold ground (people are gold, foundation v3). */
export function Avatar({ name, size = "sm" }: { name: string | null | undefined; size?: "xs" | "sm" }) {
  return (
    <span aria-hidden="true" className={cn("inline-grid shrink-0 place-items-center rounded-full bg-[var(--highlight-soft)] text-xs font-semibold text-[var(--highlight-ink)]", size === "xs" ? "size-5" : "size-7")}>
      {initials(name)}
    </span>
  );
}

/** Who changed it last: gold avatar, name · date; or "Never changed"; or "Insurvas rule". */
export function WhoCell({ name, at, rule, className }: { name?: string | null; at?: string | null; rule?: boolean; className?: string }) {
  return (
    <td className={cn("hidden whitespace-nowrap md:table-cell", className)}>
      {rule ? <span className="text-[var(--muted)]">Insurvas rule</span>
        : at ? <span className="inline-flex items-center gap-1.5 text-[var(--body)]"><Avatar size="xs" name={name ?? "Someone"} />{name ?? "Someone"} · {shortDay(at)}</span>
        : <span className="text-[var(--muted)]">Never changed</span>}
    </td>
  );
}

export type ValueKind = "yours" | "insurvas" | "locked" | "owner";

/** The one chip a row carries: Yours (green), Insurvas, Locked or Owner (a lock, neutral). */
export function ValueChip({ value, title }: { value: ValueKind; title?: string }) {
  if (value === "yours") return <StatusChip tone="action" title={title}>Yours</StatusChip>;
  if (value === "insurvas") return <StatusChip tone="neutral" title={title}>Insurvas</StatusChip>;
  return <StatusChip tone="neutral" title={title}><Lock className="size-3 shrink-0" aria-hidden="true" />{value === "locked" ? "Locked" : "Owner"}</StatusChip>;
}

/** Clicks on a row's own links and buttons keep their click; anywhere else opens the row. */
const opensFrom = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest("a, button, input, select, textarea, label");

/**
 * One line: the first cell is the row's button (the keyboard's way in), `children` are the middle cells, then › at
 * the end. The row an open sheet belongs to stays tinted, so the list behind the sheet shows where you are.
 */
export function SettingRow({ id, anchor, label, onOpen, selected, children }: {
  id?: string;
  /** A Settings-search anchor drawn inside the first cell (`<span id="tax" />`), when the row is drawn from a list. */
  anchor?: ReactNode;
  label: ReactNode;
  onOpen: () => void;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <tr id={id} aria-selected={selected || undefined} className={cn("group scroll-mt-24 cursor-pointer hover:bg-[var(--surface-alt)]", selected && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}
      onClick={(event) => { if (opensFrom(event)) onOpen(); }}>
      <td className="whitespace-nowrap">
        {anchor}
        <button type="button" title={typeof label === "string" ? label : undefined} className="block max-w-[300px] truncate text-left font-medium text-foreground outline-none focus-visible:underline" onClick={onOpen}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === " ") { event.preventDefault(); onOpen(); } }}>{label}</button>
      </td>
      {children}
      <td className="w-8 whitespace-nowrap text-right text-[var(--muted)]" aria-hidden="true">›</td>
    </tr>
  );
}

/** The Now cell: the value in plain words, one line. */
export function NowCell({ children, title }: { children: ReactNode; title?: string }) {
  return <td className="max-w-[300px] truncate whitespace-nowrap text-[var(--body)]" title={title}>{children}</td>;
}
/** The Used by cell, muted, hidden on a phone. */
export function UsedCell({ children }: { children: ReactNode }) {
  return <td className="hidden max-w-[200px] truncate whitespace-nowrap text-[var(--muted)] md:table-cell">{children}</td>;
}
/** The Value cell: the row's one chip. */
export function ValueCell({ value, title }: { value: ValueKind; title?: string }) {
  return <td className="w-[1%] whitespace-nowrap"><ValueChip value={value} title={title} /></td>;
}

/** A group's name inside the table (When money counts, Persistency): one line across every column. */
export function GroupRow({ span = 6, children }: { span?: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="bg-[var(--surface-alt)] py-1.5 text-xs font-semibold text-[var(--muted)]">{children}</td>
    </tr>
  );
}

export type Column = { label: string; md?: boolean; className?: string };
/** The board's columns: Setting · Now · Used by · Changed · Value · ›. */
export const SETTING_COLUMNS: Column[] = [
  { label: "Setting", className: "w-[30%]" },
  { label: "Now" },
  { label: "Used by", md: true },
  { label: "Changed", md: true, className: "w-[1%]" },
  { label: "Value", className: "w-[1%]" },
];

/**
 * A card of setting rows: TableCard (its title, an action, a footer), the table, and its head. The card scrolls
 * inside, not the page (foundation rule).
 */
export function SettingTable({ title, action, footer, columns = SETTING_COLUMNS, fill, className, children }: {
  title?: string;
  action?: ReactNode;
  footer?: ReactNode;
  columns?: Column[];
  /** The card takes the rest of the page's height and its rows scroll inside it. */
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableCard title={title} action={action} footer={footer} className={cn(fill && "min-h-0 flex-1", className)} bodyClassName={fill ? "min-h-0 overflow-y-auto" : undefined}>
      <table className="portal-lead-table w-full text-left text-sm" data-even="off">
        <thead>
          <tr>
            {columns.map((c) => <th key={c.label} className={cn(c.md && "hidden md:table-cell", c.className)}>{c.label}</th>)}
            <th className="w-8"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        {children}
      </table>
    </TableCard>
  );
}

/** "7 settings · 4 yours, 2 Insurvas, 1 locked", for a card's foot. */
export function countLine(values: readonly ValueKind[]) {
  const n = (k: ValueKind) => values.filter((v) => v === k).length;
  const parts = [n("yours") && `${n("yours")} yours`, n("insurvas") && `${n("insurvas")} Insurvas`, n("locked") && `${n("locked")} locked`].filter(Boolean);
  return `${values.length} setting${values.length === 1 ? "" : "s"}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
}

/** The card foot every settings table shares: the counts, then the hint (and the section's own words). */
export function SettingFoot({ values, children }: { values: readonly ValueKind[]; children?: ReactNode }) {
  return (
    <>
      <span>{countLine(values)}{children ? <> · {children}</> : null}</span>
      <span>Click a row to change it</span>
    </>
  );
}

/* ── the sheet ─────────────────────────────────────────────────────────── */

export type Affect = { label: ReactNode; where?: ReactNode };
export type HistoryItem = { key: string; who: string; line: ReactNode; at: string; onPutBack?: (() => void) | null };

/** One part of a sheet: a 16px heading, a 12px line, then its content; a rule between parts. */
export function SheetPart({ title, said, children, className }: { title?: ReactNode; said?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-border px-4 py-4 first:border-t-0", className)}>
      {title && <h3 className="m-0 text-base font-semibold text-[var(--ink)]">{title}</h3>}
      {said && <p className="m-0 mt-0.5 text-xs text-[var(--muted)]">{said}</p>}
      {children && <div className={cn("flex flex-col gap-3", (title || said) && "mt-3")}>{children}</div>}
    </section>
  );
}

/** What a setting affects: the thing, and where it lives. */
export function AffectsList({ items }: { items: readonly Affect[] }) {
  return (
    <ul className="m-0 list-none p-0">
      {items.map((a, i) => (
        <li key={i} className="flex items-center gap-2 border-b border-border py-2 text-sm text-[var(--body)] last:border-b-0">
          <span className="min-w-0">{a.label}</span>
          {a.where && <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">{a.where}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A setting's own changes, newest first; the newest can be put back. */
export function HistoryList({ items, href, hrefLabel, empty = "Never changed. It is on Insurvas's value." }: { items: readonly HistoryItem[]; href?: string; hrefLabel?: string; empty?: string }) {
  return (
    <>
      {items.length === 0 ? <p className="m-0 text-sm text-[var(--muted)]">{empty}</p> : (
        <ul className="m-0 list-none p-0">
          {items.map((h) => (
            <li key={h.key} className="flex items-start gap-2.5 border-b border-border py-2 text-sm text-[var(--body)] last:border-b-0">
              <Avatar name={h.who} />
              <div className="min-w-0 flex-1">
                <div className="text-[var(--ink)]">{h.line}</div>
                <div className="text-xs text-[var(--muted)]">{h.who} · {longWhen(h.at)}</div>
              </div>
              {h.onPutBack && <button type="button" className="shrink-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline" onClick={h.onPutBack}>Put back</button>}
            </li>
          ))}
        </ul>
      )}
      {href && <Link className="text-xs font-semibold text-[var(--accent-ink)] hover:underline" href={href}>{hrefLabel ?? "See every change ›"}</Link>}
    </>
  );
}

/** A label and its value, as the sheets' fact lists (Set by, Who to ask, Status, Covers). */
export function Facts({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[130px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-sm">
      {items.map((f) => (
        <div key={f.label} className="contents">
          <dt className="pt-0.5 text-xs text-[var(--muted)]">{f.label}</dt>
          <dd className="m-0 min-w-0 text-[var(--ink)]">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const WIDTH = { md: "lg:w-[480px]", wide: "lg:w-[640px]" } as const;

/**
 * The right sheet a setting row opens. Its first part holds the control (or, read-only, the value and why it can't
 * change here), then What it affects and History. The footer: Use Insurvas value on the left when the value is the
 * agency's own, Cancel, Save this setting. A save error shows in the sheet, under the control, and the typed value
 * stays.
 */
export function SettingSheet({ title, where, wide, canEdit, readOnlyWhy = "Only the owner changes this.", heading, said, readValue, error, busy, saveLabel = "Save this setting", saveDisabled, onSave, onUseInsurvas, insurvasLabel = "Use Insurvas value", footerStart, affects, history, historyHref, historyEmpty, onClose, children, extra }: {
  title: string;
  /** The breadcrumb under the title: "Accounting › Bills & expenses". */
  where: ReactNode;
  wide?: boolean;
  canEdit: boolean;
  readOnlyWhy?: string;
  /** The control part's heading (the setting's question); none when the title already asks it. */
  heading?: ReactNode;
  said?: ReactNode;
  readValue: ReactNode;
  error?: string | null;
  busy?: boolean;
  saveLabel?: string;
  saveDisabled?: boolean;
  onSave?: () => void;
  onUseInsurvas?: (() => void) | null;
  insurvasLabel?: string;
  /** A record's destructive action (Remove regulator), on the footer's left. */
  footerStart?: ReactNode;
  affects?: readonly Affect[];
  history?: readonly HistoryItem[];
  historyHref?: string;
  historyEmpty?: string;
  onClose: () => void;
  children?: ReactNode;
  /** More parts after the control (a preview, a list). */
  extra?: ReactNode;
}) {
  const footer = canEdit ? (
    <>
      {footerStart ?? (onUseInsurvas ? <Button type="button" variant="ghost" disabled={busy} onClick={onUseInsurvas}>{insurvasLabel}</Button> : null)}
      <span className="flex-1" />
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="button" disabled={busy || saveDisabled} onClick={onSave}>{busy ? "Saving…" : saveLabel}</Button>
    </>
  ) : (
    <><span className="flex-1" /><Button type="button" variant="outline" onClick={onClose}>Close</Button></>
  );
  return (
    <Sheet title={title} subtitle={where} onClose={() => { if (!busy) onClose(); }} footer={footer} className={wide ? WIDTH.wide : WIDTH.md} bodyClassName="flex flex-col">
      <SheetPart title={heading} said={said}>
        {canEdit ? children : (
          <>
            <div className="text-sm text-[var(--ink)]">{readValue}</div>
            <p className="m-0 flex items-center gap-1.5 text-xs text-[var(--muted)]"><Lock className="size-3 shrink-0" aria-hidden="true" />{readOnlyWhy}</p>
          </>
        )}
        {canEdit && error && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">That didn&apos;t save: {error.replace(/\.$/, "")}. Your value is kept here.</p>}
      </SheetPart>
      {extra}
      {affects && affects.length > 0 && <SheetPart title="What it affects"><AffectsList items={affects} /></SheetPart>}
      {history && <SheetPart title="History"><HistoryList items={history} href={historyHref} empty={historyEmpty} /></SheetPart>}
    </Sheet>
  );
}

/** A locked row's sheet: why it is locked, what it means day to day, who set it and who to ask. Close only. */
export function LockedSheet({ title, where, why, means, setBy = "Insurvas, for every agency", ask = "Insurvas support, from Help › Contact us", onClose, children }: {
  title: string;
  where: ReactNode;
  why: ReactNode;
  means?: readonly Affect[];
  setBy?: ReactNode;
  ask?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Sheet title={title} subtitle={<>{where} · locked</>} onClose={onClose} className={WIDTH.md} bodyClassName="flex flex-col"
      footer={<><span className="flex-1" /><Button type="button" variant="outline" onClick={onClose}>Close</Button></>}>
      <SheetPart>
        <div className="rounded-xl bg-[var(--surface-alt)] px-3.5 py-3 text-sm text-[var(--body)]">
          <b className="mb-0.5 block text-[var(--ink)]">Why this is locked</b>
          {why}
        </div>
        {children}
      </SheetPart>
      {means && means.length > 0 && <SheetPart title="What it means day to day"><AffectsList items={means} /></SheetPart>}
      <SheetPart><Facts items={[{ label: "Set by", value: setBy }, { label: "Who to ask", value: ask }]} /></SheetPart>
    </Sheet>
  );
}
