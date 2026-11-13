"use client";

import { Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Settings round 8, wave 3 (docs/design/settings-r8/team-carriers.html): the small parts Team & access,
 * Carriers and the Browser extension share. Tokens only; text 12 / 14 / 16.
 */

export type LineTone = "ok" | "warn" | "bad" | "muted";

/** A failed call, with the server's words and its status (503 = waiting on a database update). */
export class SendError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly body?: Record<string, unknown> | null) {
    super(message);
  }
}

export async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new SendError(json?.error ?? "That did not work. Try again.", response.status, json?.code, json);
  return json as T;
}

/** The status line under the title (foundation rule: a status line, never a notice card). */
export function StatusLine({ tone = "ok", children }: { tone?: LineTone; children: ReactNode }) {
  return (
    <p role="status" className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--muted)]">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "ok" && "bg-[var(--success)]",
          tone === "warn" && "bg-[var(--warning)]",
          tone === "bad" && "bg-[var(--error)]",
          tone === "muted" && "bg-[var(--muted)]",
        )}
      />
      {children}
    </p>
  );
}

/** An inline text link inside a status line or a help line. */
export function InlineLink({ onClick, href, children }: { onClick?: () => void; href?: string; children: ReactNode }) {
  const look = "font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]";
  if (href) return <a href={href} className={look}>{children}</a>;
  return <button type="button" onClick={(event) => { event.stopPropagation(); onClick?.(); }} className={cn(look, "border-0 bg-transparent p-0 text-left")}>{children}</button>;
}

export function initialsOf(name: string | null | undefined) {
  return (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** A person's initials in gold (people are gold, owner 2026-11-12). */
export function Avatar({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "large" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-[var(--highlight-soft)] font-semibold text-[var(--highlight-ink)]",
        size === "sm" && "size-[22px] text-xs",
        size === "md" && "size-7 text-xs",
        size === "large" && "size-10 text-sm",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** A section of a sheet: a hairline above, a 16px title, one help line. */
export function SheetSection({ title, help, children, id }: { title: ReactNode; help?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="m-0 text-base font-semibold text-[var(--ink)]">{title}</h3>
        {help && <p className="m-0 mt-0.5 text-xs text-[var(--muted)]">{help}</p>}
      </div>
      {children}
    </section>
  );
}

/** One pick-one card: a radio, a bold name, one line under it, and an optional note at the end. */
export function ChoiceCard({ selected, onSelect, title, help, end, disabled, name }: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  help?: ReactNode;
  end?: ReactNode;
  disabled?: boolean;
  name: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[12px] border px-3 py-2.5 transition-colors",
        selected ? "border-[var(--primary)] bg-[var(--primary-soft)] shadow-[inset_0_0_0_1px_var(--primary)]" : "border-[var(--border)] bg-[var(--color-card)] hover:bg-[var(--surface-alt)]",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name={name} className="size-4 shrink-0 accent-[var(--primary)]" checked={selected} disabled={disabled} onChange={onSelect} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        {help && <span className="block text-xs text-[var(--muted)]">{help}</span>}
      </span>
      {end && <span className="shrink-0 text-xs text-[var(--muted)]">{end}</span>}
    </label>
  );
}

/** One check line inside a confirm dialog: a box, a bold line and a smaller one under it. */
export function CheckLine({ checked, onChange, title, help, disabled }: { checked: boolean; onChange?: (next: boolean) => void; title: ReactNode; help?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-3 border-b border-[var(--border)] py-2 last:border-b-0", disabled ? "cursor-default" : "cursor-pointer")}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={checked} disabled={disabled} onChange={(event) => onChange?.(event.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        {help && <span className="block text-xs text-[var(--muted)]">{help}</span>}
      </span>
    </label>
  );
}

/** A fact tile: a small label over a 16px figure. */
export function FactTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[12px] bg-[var(--surface-alt)] px-3 py-2.5">
      <span className="block text-xs text-[var(--muted)]">{label}</span>
      <span className="block text-base font-semibold text-[var(--ink)] tabular-nums">{value}</span>
    </div>
  );
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    notify.done("Copied.");
  } catch {
    notify.fail("Your browser would not let us copy. Select the text and copy it by hand.");
  }
}

/** "Show technical details": values a support call might need, hidden from everyone else, each with Copy. */
export function TechnicalDetails({ label = "Show technical details", rows }: { label?: string; rows: { label: string; value: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-fit border-0 bg-transparent p-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline">
        {open ? label.replace(/^Show/, "Hide") : label}
      </button>
      {open && rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted)]">
          <span className="w-[150px] shrink-0 truncate">{row.label}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]">{row.value}</code>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Copy ${row.label}`} onClick={() => void copyText(row.value)}><Copy aria-hidden="true" /></Button>
        </div>
      ))}
    </div>
  );
}

/** A table row that opens a record: the whole line is the target, Enter and Space too. */
export function rowOpen(open: () => void) {
  return {
    onClick: open,
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } },
    tabIndex: 0,
    className: "cursor-pointer hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]",
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
