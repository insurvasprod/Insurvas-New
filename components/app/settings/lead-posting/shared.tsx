"use client";

import { Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Settings › Lead posting, round 8: the small parts the vendor table, sheet, wizard and tabs share.
 * Tokens only; text 12 / 14 / 16.
 */

export async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? "Something went wrong. Try again.");
  return json as T;
}

export async function copyText(value: string, what = "Copied.") {
  try {
    await navigator.clipboard.writeText(value);
    notify.done(what);
  } catch {
    // Clipboard access can be refused, and a silent no-op would look like a copy that worked.
    notify.fail("Your browser would not let us copy. Select the text and copy it by hand.");
  }
}

/** "just now", "2 min ago", "3 h ago", "4 days ago", else the date. */
export function ago(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const seconds = Math.max(0, Math.round((now - Date.parse(value)) / 1000));
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** Plain names for our lead fields, as the field map's "Goes to" shows them. */
export const OUR_FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  phone: "Phone",
  phone_number: "Phone (second choice)",
  primary_phone: "Phone (third choice)",
  email: "Email",
  state: "State",
  zip: "ZIP",
  city: "City",
  address: "Street address",
  date_of_birth: "Date of birth",
  gender: "Gender",
  product_line: "Product",
  consent_text: "Consent words",
  consent_ip: "Consent IP",
  ip: "Consent IP (second choice)",
  consent_timestamp: "Consent time",
  trusted_form_cert_url: "Consent certificate",
  trustedform_url: "Consent certificate (second choice)",
  jornaya_leadid: "Jornaya lead id",
  source_url: "Source page",
  landing_page: "Landing page",
};

/** The fields offered in "Goes to", in reading order. */
export const PICKABLE_FIELDS = ["first_name", "last_name", "full_name", "phone", "email", "state", "zip", "city", "address", "date_of_birth", "gender", "consent_text", "consent_ip", "consent_timestamp", "trusted_form_cert_url", "jornaya_leadid", "source_url", "landing_page", "product_line"];

/**
 * The status line under the title (foundation rule: a status line, not notices). One line, 12px,
 * a dot for the tone, and room for a link at the end.
 */
export function StatusLine({ tone = "ok", children }: { tone?: "ok" | "warn" | "bad" | "muted"; children: ReactNode }) {
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

/** An inline text link in the status line or a help line. */
export function InlineLink({ onClick, href, children }: { onClick?: () => void; href?: string; children: ReactNode }) {
  const look = "font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]";
  if (href) return <a href={href} className={look}>{children}</a>;
  return <button type="button" onClick={onClick} className={cn(look, "border-0 bg-transparent p-0")}>{children}</button>;
}

/**
 * "needs a database update": the tag beside a setting that waits for migration 20261112100100. Neutral,
 * not the board's gold annotation: gold is kept for people, new counts and the one feature button.
 */
export function NeedsUpdate() {
  return <span className="ml-1.5 inline-flex h-5 items-center rounded-[6px] bg-[var(--surface-alt)] px-1.5 align-middle text-xs font-medium text-[var(--muted)]">needs a database update</span>;
}

/**
 * A value people copy but never need to read (the posting address carries the workspace id): plain
 * words, the end of the value masked, and a Copy button.
 */
export function CopyField({ label, value, shown, copyLabel = "Copy" }: { label: string; value: string; shown: string; copyLabel?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--ink)]" title={label}>{shown}</span>
      <Button type="button" variant="outline" size="sm" aria-label={`${copyLabel} ${label.toLowerCase()}`} onClick={() => void copyText(value)}>
        <Copy aria-hidden="true" />
        {copyLabel}
      </Button>
    </div>
  );
}

/** The posting address with the workspace part hidden: "app.insurvas.com/api/post/••••••". */
export function maskedAddress(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}/api/post/••••••`;
  } catch {
    return "Your agency's posting address";
  }
}

/** "Show technical details": what a developer might need, hidden from everyone else, with Copy. */
export function TechnicalDetails({ rows }: { rows: { label: string; value: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-fit border-0 bg-transparent p-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline">
        {open ? "Hide technical details" : "Show technical details"}
      </button>
      {open && rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted)]">
          <span className="w-[120px] shrink-0">{row.label}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]">{row.value}</code>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Copy ${row.label.toLowerCase()}`} onClick={() => void copyText(row.value)}><Copy aria-hidden="true" /></Button>
        </div>
      ))}
    </div>
  );
}

/** A section of the vendor sheet: a hairline above, a 14px title, one help line. */
export function SheetSection({ title, help, tag, children }: { title: string; help?: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">{title}{tag}</h3>
        {help && <p className="m-0 mt-0.5 text-xs text-[var(--muted)]">{help}</p>}
      </div>
      {children}
    </section>
  );
}

/** A pick-one card: radio, title, one line under it, something at the end. Disabled cards still show why. */
export function ChoiceCard({ selected, disabled, onSelect, title, sub, end, name }: { selected: boolean; disabled?: boolean; onSelect: () => void; title: ReactNode; sub?: ReactNode; end?: ReactNode; name: string }) {
  return (
    <label className={cn("flex min-w-0 items-center gap-3 rounded-[10px] border px-3 py-2.5", selected ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]", disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[var(--surface-alt)]")}>
      <input type="radio" name={name} checked={selected} disabled={disabled} onChange={onSelect} className="size-4 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--ink)]">{title}</span>
        {sub && <span className="block truncate text-xs text-[var(--muted)]">{sub}</span>}
      </span>
      {end && <span className="shrink-0 text-xs text-[var(--muted)]">{end}</span>}
    </label>
  );
}

export const US_ZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
];
