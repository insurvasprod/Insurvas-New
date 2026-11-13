"use client";

import { Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { dateTime, dayMonth, viewerTimeZone } from "@/lib/format/dates";
import { requestSample, type SampleLanguage } from "@/lib/apiKeys/hub";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Settings › Integrations, round 8 option A: the small parts the hub's tables, sheets and steps share.
 * Tokens only; text 12 / 14 / 16.
 */

export async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(json?.error ?? "That did not work. Try again."), { code: json?.code as string | undefined, status: response.status });
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

const zone = () => viewerTimeZone();

/** "Today 9:14 AM", "Yesterday 4:51 PM", "Nov 9", or "Never". */
export function whenWords(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "Never";
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "—";
  const time = dateTime(value, zone(), { clock: "12h" }).split(", ")[1] ?? "";
  const day = (ms: number) => dayMonth(new Date(ms).toISOString(), zone());
  if (day(at) === day(now)) return `Today ${time}`;
  if (day(at) === day(now - 86_400_000)) return `Yesterday ${time}`;
  return day(at);
}

/** "9:41 AM" today, else "Nov 9, 9:41 AM". */
export function clockWords(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const full = dateTime(value, zone(), { clock: "12h" });
  return dayMonth(value, zone()) === dayMonth(new Date(now).toISOString(), zone()) ? full.split(", ")[1] ?? full : full;
}

/** "in 8 min", "in 2 h", "now". */
export function inWords(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const minutes = Math.round((Date.parse(value) - now) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.round(minutes / 60)} h`;
}

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

/** An inline text link: the status line, a help line, a table's "Managed in". */
export function InlineLink({ onClick, href, children }: { onClick?: () => void; href?: string; children: ReactNode }) {
  const look = "font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]";
  if (href) return <a href={href} className={look}>{children}</a>;
  return <button type="button" onClick={(event) => { event.stopPropagation(); onClick?.(); }} className={cn(look, "border-0 bg-transparent p-0 text-left")}>{children}</button>;
}

/** "Show technical details": what a developer might need, hidden from everyone else, each with Copy. */
export function TechnicalDetails({ rows }: { rows: { label: string; value: string; shown?: string; copy?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-fit border-0 bg-transparent p-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline">
        {open ? "Hide technical details" : "Show technical details"}
      </button>
      {open && rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted)]">
          <span className="w-[120px] shrink-0">{row.label}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]">{row.shown ?? row.value}</code>
          {row.copy !== false && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Copy ${row.label.toLowerCase()}`} onClick={() => void copyText(row.value)}><Copy aria-hidden="true" /></Button>}
        </div>
      ))}
    </div>
  );
}

/** A section of a sheet: a hairline above, a 14px title, one help line. */
export function SheetSection({ title, help, tag, children }: { title: string; help?: ReactNode; tag?: ReactNode; children: ReactNode }) {
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

/** "needs a database update": beside a choice that waits for a migration. Neutral, never gold. */
export function NeedsUpdate() {
  return <span className="ml-1.5 inline-flex h-5 items-center rounded-[6px] bg-[var(--surface-alt)] px-1.5 align-middle text-xs font-medium text-[var(--muted)]">needs a database update</span>;
}

/** A person: gold initials (people are gold, owner 2026-11-12), then the name. */
export function Person({ name }: { name: string | null }) {
  if (!name) return <span className="text-[var(--muted)]">—</span>;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className="inline-grid size-5 shrink-0 place-items-center rounded-full bg-[var(--highlight-soft)] text-xs font-semibold text-[var(--highlight-ink)]">{initials}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A code block with a curl · JavaScript switch and Copy. */
export function CodeCard({ code, language, onLanguage, copyLabel = "Copy" }: { code: string; language?: SampleLanguage; onLanguage?: (language: SampleLanguage) => void; copyLabel?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] border border-[var(--border)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5">
        {language && onLanguage ? (
          <div role="radiogroup" aria-label="Language" className="flex items-center gap-1">
            {(["curl", "js"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={language === item}
                onClick={() => onLanguage(item)}
                className={cn("border-0 rounded-[6px] px-2.5 py-1 text-xs font-medium", language === item ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "bg-transparent text-[var(--muted)] hover:text-[var(--ink)]")}
              >
                {item === "curl" ? "curl" : "JavaScript"}
              </button>
            ))}
          </div>
        ) : <span className="px-1 text-xs text-[var(--muted)]">Example</span>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void copyText(code)}><Copy aria-hidden="true" />{copyLabel}</Button>
      </div>
      <pre className="m-0 max-h-[260px] overflow-auto bg-[var(--surface-sunken)] px-3 py-2.5 font-mono text-xs leading-[1.6] whitespace-pre text-[var(--body)]">{code}</pre>
    </div>
  );
}

/** A request sample for a key, with its own language switch. */
export function RequestSample({ origin, path, apiKey }: { origin: string; path: string; apiKey?: string }) {
  const [language, setLanguage] = useState<SampleLanguage>("curl");
  return <CodeCard code={requestSample(language, origin, apiKey, path)} language={language} onLanguage={setLanguage} />;
}

/** The steps along the top of a pop-up: done ✓, the current one green, the rest muted. */
export function Steps({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label="Steps">
      {steps.map((label, index) => {
        const done = index < at;
        const on = index === at;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={on ? "step" : undefined}>
            {index > 0 && <span aria-hidden="true" className="h-px w-4 bg-[var(--border)]" />}
            <span className={cn("inline-flex items-center gap-1.5 text-xs", on ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]")}>
              <span aria-hidden="true" className={cn("inline-grid size-5 place-items-center rounded-full text-xs font-semibold", on ? "bg-[var(--primary)] text-[var(--on-primary)]" : done ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "bg-[var(--surface-alt)] text-[var(--muted)]")}>{done ? "✓" : index + 1}</span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A tick card: a checkbox, a title and one line, something at the end. */
export function TickCard({ checked, disabled, onChange, title, sub, end }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; title: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  return (
    <label className={cn("flex min-w-0 items-center gap-3 rounded-[10px] border px-3 py-2.5", checked ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]", disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[var(--surface-alt)]")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-4 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        {sub && <span className="block text-xs text-[var(--muted)]">{sub}</span>}
      </span>
      {end && <span className="shrink-0 text-xs text-[var(--muted)]">{end}</span>}
    </label>
  );
}

/** A pick-one card: radio, title, one line under it. */
export function ChoiceCard({ selected, onSelect, title, sub, name }: { selected: boolean; onSelect: () => void; title: ReactNode; sub?: ReactNode; name: string }) {
  return (
    <label className={cn("flex min-w-0 cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5 hover:bg-[var(--surface-alt)]", selected ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]")}>
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="size-4 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        {sub && <span className="block text-xs text-[var(--muted)]">{sub}</span>}
      </span>
    </label>
  );
}

/** The key or secret, shown once: dashed box, the value, Copy. */
export function ShownOnce({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <div className="rounded-[12px] border border-dashed border-[var(--border-strong)] bg-[var(--surface-sunken)] p-4 text-center">
      <div className="mb-1.5 text-xs text-[var(--muted)]">{label}</div>
      <code className="block font-mono text-sm break-all text-[var(--ink)]">{value}</code>
      <div className="mt-3 flex justify-center"><Button type="button" onClick={() => void copyText(value, `${label} copied.`)}><Copy aria-hidden="true" />{copyLabel}</Button></div>
    </div>
  );
}
