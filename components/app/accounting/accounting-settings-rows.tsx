"use client";

import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { COLUMNS, type AccountingSettings } from "@/lib/accounting/settingsCore";
import { notify } from "@/lib/notify";

/**
 * Settings › Accounting, round 7 (owner pick 7·A "A tab per page, rows open a dialog", 2026-11-10;
 * docs/la4/mockups-r7/accounting.html §7). The parts the six tabs share: a setting row (Setting · Now · Used by ·
 * Changed · Edit ›) that opens its dialog, a row that opens another page, a lock row that never opens (its reason
 * behind the (i)), a group line, the md/lg dialog, and the save that sends only the keys a dialog changed.
 * The pattern Retention settings took in round 7 (components/app/retention/retention-settings-rows.tsx).
 */

/** Clicks on the row's own links and buttons keep their click; anywhere else opens the row. */
const opensFrom = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest("a, button, input, select, textarea, label");

export const READ_ONLY_WORDS = "Only the owner changes these";

/**
 * The last cell: a short verb with › in the normal colour (owner 2026-11-11, one colour per table). Edit › for the
 * owner; View › for everyone else, the read-only words its tooltip (the dialog shows the value with Close only).
 */
function EditCell({ canEdit, label = "Edit" }: { canEdit: boolean; label?: string }) {
  return (
    <td className="w-[1%] whitespace-nowrap text-right" aria-hidden="true" title={canEdit ? undefined : READ_ONLY_WORDS}>
      {canEdit ? label : "View"} ›
    </td>
  );
}

/** One setting: the value in words, the page it changes, who changed it last. A click anywhere opens its dialog. */
export function SettingLine({ id, label, now, usedBy, changed, canEdit, onOpen }: {
  id?: string;
  label: ReactNode;
  now: ReactNode;
  usedBy: ReactNode;
  changed: ReactNode;
  canEdit: boolean;
  onOpen: () => void;
}) {
  return (
    <tr id={id} className="group scroll-mt-24 cursor-pointer hover:bg-[var(--primary-soft)]" onClick={(event) => { if (opensFrom(event)) onOpen(); }}>
      <td className="whitespace-nowrap"><button type="button" className="text-left font-medium text-foreground outline-none focus-visible:underline" onClick={onOpen}>{label}</button></td>
      <td className="whitespace-nowrap">{now}</td>
      <td className="hidden whitespace-nowrap md:table-cell">{usedBy}</td>
      <td className="hidden whitespace-nowrap md:table-cell">{changed}</td>
      <EditCell canEdit={canEdit} />
    </tr>
  );
}

/** A row kept on another page (the bank accounts): the whole row is a link there. */
export function PageLine({ id, label, now, usedBy, href }: { id?: string; label: ReactNode; now: ReactNode; usedBy: ReactNode; href: string }) {
  const router = useRouter();
  return (
    <tr id={id} className="group scroll-mt-24 cursor-pointer hover:bg-[var(--primary-soft)]" onClick={(event) => { if (opensFrom(event)) router.push(href); }}>
      <td className="whitespace-nowrap"><Link href={href} className="font-medium text-foreground outline-none focus-visible:underline">{label}</Link></td>
      <td className="whitespace-nowrap">{now}</td>
      <td className="hidden whitespace-nowrap md:table-cell">{usedBy}</td>
      <td className="hidden whitespace-nowrap md:table-cell">Kept there</td>
      <td className="w-[1%] whitespace-nowrap text-right" aria-hidden="true">Open ›</td>
    </tr>
  );
}

/** A safety limit: a row that never opens. Its reason sits behind the (i) at the row's end. */
export function LockLine({ label, now, why, reason }: { label: string; now: ReactNode; why: string; reason: ReactNode }) {
  return (
    <tr>
      <td className="whitespace-nowrap"><span className="inline-flex items-center gap-2 font-medium text-foreground"><Lock className="size-4 shrink-0" aria-hidden="true" />{label}</span></td>
      <td className="whitespace-nowrap">{now}</td>
      <td className="hidden whitespace-nowrap md:table-cell">Kept by Insurvas</td>
      <td className="hidden md:table-cell" />
      <td className="w-[1%] text-right"><InfoTip label={why} side="left"><b className="block font-semibold text-[var(--ink)]">{why}</b><span className="mt-1.5 block">{reason}</span></InfoTip></td>
    </tr>
  );
}

/** A group's name inside the table: one line across every column. */
export function GroupLine({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={5} className="bg-[var(--surface-alt)] text-xs font-semibold text-muted-foreground">{children}</td>
    </tr>
  );
}

/** The column heads every tab shares. */
export function SettingHead() {
  return (
    <thead>
      <tr>
        <th className="w-[300px]">Setting</th>
        <th>Now</th>
        <th className="hidden md:table-cell">Used by</th>
        <th className="hidden w-[180px] md:table-cell">Changed</th>
        <th className="w-10"><span className="sr-only">Open</span></th>
      </tr>
    </thead>
  );
}

/**
 * One setting's dialog (board 7·2, Dialog md 440 / lg 560): what the setting does, its control, Cancel and Save.
 * Read-only: the value as text and only Close.
 */
export function AccountingDialog({ title, said, size = "md", canEdit, readValue, busy, saveDisabled, onSave, onClose, children }: {
  title: string;
  said: ReactNode;
  size?: "md" | "lg";
  canEdit: boolean;
  readValue: ReactNode;
  busy: boolean;
  saveDisabled?: boolean;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription>{said}</DialogDescription>
        </DialogHeader>
        {canEdit ? <div className="flex flex-col gap-4">{children}</div> : <div className="text-sm text-[var(--ink)]">{readValue}</div>}
        <DialogFooter className="border-t border-border pt-4 sm:items-center">
          {canEdit ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={busy || saveDisabled} onClick={onSave}>{busy ? "Saving…" : "Save"}</Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A field's error line, under its control. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{children}</p> : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function patchSettings(patch: Partial<AccountingSettings>): Promise<AccountingSettings> {
  const body = Object.fromEntries(Object.entries(patch).map(([key, value]) => [COLUMNS[key as keyof AccountingSettings], value]));
  const res = await fetch("/api/app/accounting/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json.settings as AccountingSettings;
}

/**
 * A dialog's save (edit map 7: "PATCH accounting/settings (one key)"): only the keys whose value changed go to the
 * PATCH, which takes a partial body. The toast offers Undo, which sends the old values of those keys back.
 */
export function useAccountingSave(current: AccountingSettings, onSaved: (next: AccountingSettings) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Partial<AccountingSettings>): Promise<boolean> => {
    const keys = (Object.keys(patch) as (keyof AccountingSettings)[]).filter((k) => !same(patch[k], current[k]));
    if (!keys.length) { notify.done("Nothing changed"); return true; }
    const changed = Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<AccountingSettings>;
    const before = Object.fromEntries(keys.map((k) => [k, current[k]])) as Partial<AccountingSettings>;
    setBusy(true);
    try {
      onSaved(await patchSettings(changed));
      router.refresh();
      notify.done("Saved. Recorded figures are unchanged.", {
        action: {
          label: "Undo",
          onClick: () => void patchSettings(before).then(
            (next) => { onSaved(next); router.refresh(); notify.done("Put back as it was."); },
            (err: unknown) => notify.fail(err instanceof Error ? err.message : "That didn't save"),
          ),
        },
      });
      return true;
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}
