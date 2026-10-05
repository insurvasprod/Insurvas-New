"use client";

/**
 * Pieces the Settings › Sales panels share. Built from the settings primitives and the shared UI
 * components — nothing here restyles a shared component, and every panel is laid out the way the
 * other settings sections are (UI-CONSISTENCY): the section header, one-line Callouts for errors /
 * blocked / read-only states, TableCards for lists, SettingsCards for forms, and SettingsSaveBar
 * for a draft. `notSaved` / `notRefreshed` are the sample-mode (`?preview=sample`) answers; the live
 * panels call their routes through `salesApi`.
 */

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Copy } from "lucide-react";
import { notify } from "@/lib/notify";

import { SampleDataNotice } from "@/components/app/applications/parts";
import { Callout, Pill, SettingsSectionHeader, type PillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

export const NOT_SAVED = "Sample data — not saved";

/** Every action in these panels lands here while they read fixtures. */
export function notSaved() {
  notify.done(NOT_SAVED);
}

export function notRefreshed() {
  notify.done("Sample data — there is nothing new to load.");
}

/** Said when a panel refuses to switch away from unsaved edits (the same words on every panel). */
export function warnUnsaved(what: string) {
  notify.warn("Save or discard your changes first", { detail: `${what} has changes that are not saved.` });
}

export const OWNER_ONLY = "Only an owner can change this.";

/** The panel's top: the section title/purpose (from the provider), then the sample notice. */
export function SalesPanelTop({ sample = true }: { sample?: boolean }) {
  return (
    <>
      <SettingsSectionHeader />
      {sample && <SampleDataNotice />}
    </>
  );
}

/* ── the states a panel can be in before it has data ────────────────────── */

/** In place of the panel while it loads — the same skeleton every settings section shows. */
export function SalesLoading({ label, rows = 4, columns = 4 }: { label: string; rows?: number; columns?: number }) {
  return <TableCard><SectionLoading rows={rows} columns={columns} label={label} /></TableCard>;
}

/** The load failed: one line saying what, and the way to try again. */
export function SalesLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <Callout tone="error" title={message} />
      <div><Button type="button" variant="outline" onClick={onRetry}>Try again</Button></div>
    </>
  );
}

/** A panel whose database update has not been applied: one actionable line. */
export function SalesSetupPending({ what = "This section" }: { what?: string }) {
  return <Callout tone="warning" title={`${what} isn't set up yet. Ask your Insurvas admin to apply the latest database migrations.`} />;
}

/** Producers see the values; only an owner changes them. */
export function ReadOnlyNotice({ what }: { what: string }) {
  return <Callout tone="info" title={`Only an owner can change ${what}. You are seeing what is in force.`} />;
}

/* ── controls ───────────────────────────────────────────────────────────── */

/**
 * A disabled Button does not receive pointer events, so its own `title` never shows. The reason
 * sits on a wrapper instead — every disabled control says why.
 */
export function WithReason({ reason, children }: { reason?: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return <span title={reason} className="inline-flex">{children}</span>;
}

/** A row's action: the last column, right-aligned, a small outline button (UI-CONSISTENCY §6). */
export function RowAction({ onClick, children, label, disabled, reason }: { onClick: () => void; children: ReactNode; label?: string; disabled?: boolean; reason?: string | null }) {
  return (
    <WithReason reason={disabled ? reason : null}>
      <Button type="button" variant="outline" size="sm" onClick={onClick} aria-label={label} disabled={disabled}>
        {children}
      </Button>
    </WithReason>
  );
}

export function CopyToAgencyButton({ label, size = "sm", onClick, text = "Copy to my agency", disabled, reason }: { label: string; size?: "sm" | "default"; onClick?: () => void; text?: string; disabled?: boolean; reason?: string | null }) {
  return (
    <WithReason reason={disabled ? reason : null}>
      <Button type="button" variant="outline" size={size} onClick={onClick ?? notSaved} aria-label={`${text} — ${label}`} disabled={disabled}>
        <Copy aria-hidden="true" />
        {text}
      </Button>
    </WithReason>
  );
}

/** A back link above an editor that replaced its list. */
export function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div>
      <Button type="button" variant="ghost" onClick={onClick} className="-ml-3">
        ← {children}
      </Button>
    </div>
  );
}

/** Discard + Save changes for a SettingsSaveBar. A save that cannot go says why. */
export function DiscardSave({ saving, problem, onDiscard, onSave, saveLabel = "Save changes" }: { saving: boolean; problem?: string | null; onDiscard: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
      <WithReason reason={problem}>
        <Button type="button" onClick={onSave} disabled={saving || Boolean(problem)}>{saving ? "Saving…" : saveLabel}</Button>
      </WithReason>
    </>
  );
}

/* ── pills ──────────────────────────────────────────────────────────────── */

export function PlatformPill() {
  return <Pill tone="neutral">Platform default</Pill>;
}

/** The one lifecycle vocabulary for every versioned thing in these panels. */
export type Lifecycle = "live" | "draft" | "retired" | "platform";
const LIFECYCLE: Record<Lifecycle, { tone: PillTone; label: string }> = {
  live: { tone: "success", label: "Live" },
  draft: { tone: "info", label: "Draft" },
  retired: { tone: "neutral", label: "Retired" },
  platform: { tone: "neutral", label: "Platform default" },
};
export function LifecyclePill({ state }: { state: Lifecycle }) {
  return <Pill tone={LIFECYCLE[state].tone}>{LIFECYCLE[state].label}</Pill>;
}

/** A row's version chip: brand when it is the live one, neutral otherwise (board). */
export function VersionPill({ version, live }: { version: number; live: boolean }) {
  return <Pill tone={live ? "brand" : "neutral"}>v{version}</Pill>;
}

/* ── words ──────────────────────────────────────────────────────────────── */

export function plural(n: number, word: string) {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "26 Sep". Built by hand: Node's ICU prints "Sept" where browsers print "Sep", which breaks hydration. */
export function shortDay(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Last changed 28 Sep 2026 by Rinor G." — or that nothing has been saved and these are the defaults. */
export function changedLine(updatedAt: string | null, updatedBy: string | null, fallback = "Not changed yet — these are the defaults.") {
  if (!updatedAt) return fallback;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return fallback;
  return `Last changed ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}${updatedBy ? ` by ${updatedBy}` : ""}`;
}

/** A muted one-line fact in a card's action slot (e.g. who last changed it). */
export function CardFact({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{children}</span>;
}

/* ── dialogs ────────────────────────────────────────────────────────────── */

export function SalesDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[18px] text-[var(--ink)]">{title}</DialogTitle>
          {description && <DialogDescription className="text-[14px] leading-[1.5] text-[var(--muted)]">{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** A dialog's footer row: Cancel, then the one action. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">{children}</div>;
}

export const checkbox = "size-4 shrink-0 accent-[var(--brand-500)]";

/* ── live panels ─────────────────────────────────────────── */

/** `?preview=sample` outside production: the panel renders its design fixtures and saves nothing. */
export function useSalesSample() {
  return useSearchParams().get("preview") === "sample" && process.env.NODE_ENV !== "production";
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; schemaPending?: boolean };

/** One JSON call to a Settings › Sales route, its failure turned into a sentence. */
export async function salesApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: data?.error ?? "That did not work. Try again.", schemaPending: Boolean(data?.schemaPending) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach Insurvas. Check your connection and try again." };
  }
}
