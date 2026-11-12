"use client";

import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Settings › Retention, round 7 (owner pick 7·A, 2026-11-10; docs/la4/mockups-r7/retention.html §7): every setting
 * is one row of a table, and the row opens a dialog that edits that one setting. These are the parts the five tabs
 * and the weights page share: the row, a group line inside the table, the md dialog with "Back to Insurvas's", the
 * number input, and the two saves (the settings hub and the ladder rules).
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
 * One setting's dialog (board 7·2, Dialog md 440): its fields, an error line the owner can fix, "Back to Insurvas's"
 * when the value is the agency's own, Cancel and Save. Read-only: the value as text and only Close.
 */
export function SettingDialog({ title, said, canEdit, kept = false, readValue, error, busy, saveDisabled, onSave, onBack, onClose, children }: {
  title: string;
  /** Insurvas keeps the value (read-only for everyone), so Close carries no read-only hint. */
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
  children?: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          {said ? <DialogDescription>{said}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {canEdit ? (
          <div className="flex flex-col gap-4">{children}</div>
        ) : (
          <div className="text-sm text-[var(--ink)]">{readValue}</div>
        )}
        {canEdit && error && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{error}</p>}
        <DialogFooter className="border-t border-border pt-4 sm:items-center">
          {canEdit ? (
            <>
              {onBack && <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>Back to Insurvas&apos;s</Button>}
              <span className="hidden flex-1 sm:block" />
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={busy || saveDisabled} onClick={onSave}>{busy ? "Saving…" : "Save"}</Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={onClose} title={kept ? undefined : "Paused while the account is read-only."}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
