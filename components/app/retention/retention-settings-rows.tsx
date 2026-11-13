"use client";

import Link from "next/link";
import { createContext, useContext, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { SettingSheet, type Affect, type HistoryItem } from "@/components/app/settings/money/setting-kit";
import { control, Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Settings › Retention, round 7 (owner pick 7·A, 2026-11-10) and round 8 (docs/design/settings-r8/
 * money-compliance-settings.html §4–5, owner "Build all four" 2026-11-12): every setting is one row of a table, and
 * the row opens a right sheet that edits that one setting. These are the parts the tabs share: the Ladder tab's row,
 * a group line inside the table, the setting sheet with "Use Insurvas value", the number input, and the two saves
 * (the settings hub and the ladder rules).
 */

/** Clicks on the row's own links and buttons keep their click; anywhere else opens the row. */
const opensFrom = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest("a, button, input, select, textarea, label");

/**
 * A row that opens its dialog (or, with `href`, its page): one click anywhere on it, a hover tint and a short verb
 * with › at its end (Edit › for the owner, View › for everyone else, Open › for a page; owner 2026-11-11, one line
 * and one colour per row). The label is the row's button (or link), so the keyboard has one way in.
 */
export function OpenRow({ id, label, sub, onOpen, href, canEdit = true, children }: {
  id?: string;
  label: ReactNode;
  /** One short qualifier, kept in the label's tooltip (a row is one line). */
  sub?: string;
  onOpen?: () => void;
  href?: string;
  /** Edit › for the owner, View › for a read-only viewer. */
  canEdit?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const open = () => (href ? router.push(href) : onOpen?.());
  return (
    <tr id={id} className="group scroll-mt-24 cursor-pointer hover:bg-[var(--primary-soft)]" onClick={(event) => { if (opensFrom(event)) open(); }}>
      <td className="whitespace-nowrap" title={sub}>
        {href ? (
          <Link href={href} className="font-medium text-foreground outline-none focus-visible:underline">{label}</Link>
        ) : (
          <button type="button" className="text-left font-medium text-foreground outline-none focus-visible:underline" onClick={onOpen}>{label}</button>
        )}
      </td>
      {children}
      <td className="w-[1%] whitespace-nowrap text-right" aria-hidden="true">{href ? "Open" : canEdit ? "Edit" : "View"} ›</td>
    </tr>
  );
}

/** A group's name inside the table (Thresholds, Paper bill to bank draft): one line across every column. */
export function GroupRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="bg-[var(--surface-alt)] text-xs font-semibold text-muted-foreground">{children}</td>
    </tr>
  );
}

/** A number, linked to the page it counts (every number links to its filtered page). */
export function CountLink({ href, value, label }: { href: string; value: number; label?: string }) {
  return (
    <Link href={href} className="whitespace-nowrap tabular-nums text-foreground hover:underline">
      {value.toLocaleString("en-US")}{label ? ` ${label}` : ""}
    </Link>
  );
}

/**
 * What the board knows about the setting a sheet is open on, handed to it without threading props through every
 * dialog: where it sits, what it affects, its own history (Put back on the newest change), and the link to every
 * Retention change. Round 8 (docs/design/settings-r8/money-compliance-settings.html §4–5).
 */
export type SheetContext = { where?: string; affects?: readonly Affect[]; history?: readonly HistoryItem[]; historyHref?: string; readOnlyWhy?: string };
const SheetInfo = createContext<SheetContext>({});
export const SheetInfoProvider = SheetInfo.Provider;

/**
 * One setting's sheet (round 8: a right sheet in place of round 7's md dialog; the props are round 7's, so every
 * Retention dialog and the Ladder tab's open the same way): its fields, an error the owner can fix beside them, Use
 * Insurvas value when the value is the agency's own, Cancel and Save this setting; then What it affects and its
 * History. Read-only: the value, why it can't change here, and only Close.
 */
export function SettingDialog({ title, said, canEdit, kept = false, readValue, error, busy, saveDisabled, onSave, onBack, onClose, wide, children }: {
  title: string;
  /** Insurvas keeps the value (read-only for everyone): the sheet says so instead of "only the owner". */
  kept?: boolean;
  /** What the setting changes, and whose the value is. */
  said?: ReactNode;
  canEdit: boolean;
  /** The value as text, for a read-only viewer. */
  readValue: ReactNode;
  error?: string | null;
  busy?: boolean;
  saveDisabled?: boolean;
  onSave?: () => void;
  /** Shown when the value is the agency's own. */
  onBack?: (() => void) | null;
  onClose: () => void;
  wide?: boolean;
  children?: ReactNode;
}) {
  const info = useContext(SheetInfo);
  return (
    <SettingSheet title={title} where={`Retention › ${info.where ?? "Settings"}`} wide={wide} canEdit={canEdit}
      readOnlyWhy={kept ? "Insurvas keeps this for every agency." : info.readOnlyWhy ?? "Your plan's billing is paused, so nothing saves."}
      said={said} readValue={readValue} error={error} busy={busy} saveDisabled={saveDisabled} onSave={onSave}
      onUseInsurvas={onBack ?? null} affects={info.affects} history={kept ? undefined : info.history} historyHref={info.historyHref}
      onClose={onClose}>
      {children}
    </SettingSheet>
  );
}

/** A whole-number input in a dialog, shown in its own units (% for basis points, $ for cents). */
export function NumberField({ id, label, value, onChange, unit, hint, autoFocus }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  hint?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <Field label={unit ? `${label} (${unit})` : label} htmlFor={id} hint={hint}>
      <input id={id} autoFocus={autoFocus} inputMode="decimal" className={cn(control, "tabular-nums")} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} />
    </Field>
  );
}

/** The settings hub's one endpoint (the same POST the long form used). */
export async function postSettings(body: Record<string, unknown>): Promise<{ changes?: unknown[]; preview?: unknown }> {
  const res = await fetch("/api/app/retention/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json ?? {};
}

/** The ladder rules' endpoint: the whole rule set, every save. */
export async function putLadderRules(rules: { disabled: string[]; urgentDays: number; unreachableAfter: number }) {
  const response = await fetch("/api/app/retention/ladder-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled: rules.disabled, urgent_days: rules.urgentDays, unreachable_after: rules.unreachableAfter }) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The rules could not be saved.");
}

/** A dialog's save: busy while it runs, its error on the dialog's error line. */
export function useDialogSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
