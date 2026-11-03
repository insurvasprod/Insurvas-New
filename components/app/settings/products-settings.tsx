"use client";

/**
 * Settings › Products (option A, owner pick 2026-10-27; Notion LA-1.3 + SA-4.5). Every product in the
 * Insurvas catalogue with a switch, grouped by line. What the plan does not include is shown locked.
 * A sold product says which partners may send it and whether its form is set up. Turning one on saves
 * at once with Undo; turning one off says what stops and what keeps working first (foundation v3 §11).
 * Every product picker in the app reads this same answer (lib/products/agencyProducts.ts).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Callout, SettingsCard, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/field";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

type Row = {
  code: string;
  name: string;
  category: string;
  inPlan: boolean;
  enabled: boolean;
  sold: boolean;
  partners: string[];
  formReady: boolean;
  carriers: number;
};

const CATEGORY_LABEL: Record<string, string> = { life: "Life", health: "Health", retirement: "Retirement" };
const CATEGORY_ORDER = ["life", "health", "retirement"];

function partnersText(partners: string[]) {
  if (partners.length === 0) return "No partner may send it yet";
  if (partners.length <= 2) return `${partners.join(" and ")} may send it`;
  return `${partners.slice(0, 2).join(", ")} and ${partners.length - 2} more may send it`;
}

export function ProductsSettings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<Row | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/settings/products", { cache: "no-store" }).then(async (response) => {
      const body = (await response.json().catch(() => null)) as { products?: Row[]; error?: string } | null;
      if (!live) return;
      if (!response.ok || !body?.products) { setError(body?.error ?? "Your products could not be loaded."); return; }
      setRows(body.products);
    });
    return () => { live = false; };
  }, []);

  async function save(row: Row, sold: boolean, undoable = true) {
    // The switch moves at once (2026-10-29: every switch waited a second for the server); a save that
    // fails puts it back and says so.
    const before = rows;
    setRows((current) => current?.map((item) => (item.code === row.code ? { ...item, enabled: sold, sold } : item)) ?? current);
    setBusy(row.code);
    const response = await fetch("/api/app/settings/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_code: row.code, sold }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { products?: Row[]; error?: string } | null;
    setBusy(null);
    if (!response?.ok || !body?.products) { setRows(before); notify.block(body?.error ?? "That change could not be saved. Try again."); return; }
    setRows(body.products);
    notify.done(sold ? `You sell ${row.name}` : `You no longer sell ${row.name}`, {
      detail: sold ? "Leads, partners, forms and quotes now offer it." : "Nothing new can use it; what already exists keeps working.",
      action: undoable ? { label: "Undo", onClick: () => void save(row, !sold, false) } : undefined,
    });
  }

  if (error) return <SettingsStack><SettingsSectionHeader /><Callout tone="error" title={error} /></SettingsStack>;
  if (!rows) return <SettingsStack><SettingsSectionHeader /><SettingsCard><SectionLoading rows={6} columns={3} label="Loading your products" /></SettingsCard></SettingsStack>;

  const sold = rows.filter((row) => row.sold).length;
  const inPlan = rows.filter((row) => row.inPlan).length;
  const groups = [...new Set([...CATEGORY_ORDER, ...rows.map((row) => row.category)])]
    .map((category) => ({ category, rows: rows.filter((row) => row.category === category) }))
    .filter((group) => group.rows.length > 0);

  const live = groups.flatMap((group) => group.rows).filter((row) => row.inPlan);
  const locked = groups.flatMap((group) => group.rows).filter((row) => !row.inPlan);

  return (
    <SettingsStack className="flex-1 gap-3">
      <SettingsSectionHeader actions={<StatusChip tone={sold ? "good" : "neutral"} dot={false}>{sold} sold · {inPlan} in your plan</StatusChip>} />
      {sold === 0 && <p className="m-0 text-sm text-[var(--muted)]">Choose the products you sell. Partners cannot send leads, and forms and quotes have nothing to offer, until you do.</p>}
      <div id="products-list" className="m-glass flex min-w-0 flex-1 flex-col rounded-[12px] border border-[var(--border)]">
        {live.map((row, index) => (
          <div key={row.code} className={cn("flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-[var(--border)] px-4 py-3", index > 0 && "border-t")}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--ink)]">{row.name}</div>
              <div className="text-xs text-[var(--muted)]">{CATEGORY_LABEL[row.category] ?? row.category} · {row.sold ? partnersText(row.partners) : "not sold"}</div>
            </div>
            {row.sold && (
              <span className="flex flex-wrap items-center gap-2">
                {row.carriers > 0 && <span className="text-xs text-[var(--muted)]">{row.carriers} {row.carriers === 1 ? "carrier offers" : "carriers offer"} it</span>}
                {row.formReady
                  ? <StatusChip tone="good" dot>Form ready</StatusChip>
                  : <Link href="/app/settings#form-templates" className="text-xs font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">Set up its form</Link>}
              </span>
            )}
            <Switch
              checked={row.enabled}
              label={`Sell ${row.name}`}
              onChange={(next) => { if (busy === row.code) return; if (next) void save(row, true); else setConfirmOff(row); }}
            />
          </div>
        ))}
        {locked.length > 0 && (
          <>
            <div className="border-t border-[var(--border)] px-4 pt-3 pb-1 text-xs font-semibold text-[var(--muted)]">Not in your plan</div>
            {locked.map((row) => (
              <div key={row.code} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--muted)]">{row.name}</div>
                  <div className="text-xs text-[var(--muted)]">{CATEGORY_LABEL[row.category] ?? row.category}</div>
                </div>
                <Link href="/app/settings#billing" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">
                  <Lock aria-hidden className="size-3.5" />See plans
                </Link>
              </div>
            ))}
          </>
        )}
      </div>

      <Dialog open={confirmOff !== null} onOpenChange={(open) => { if (!open) setConfirmOff(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          {confirmOff && (
            <>
              <DialogHeader>
                <DialogTitle>Stop selling {confirmOff.name}?</DialogTitle>
                <DialogDescription>Nothing is deleted.</DialogDescription>
              </DialogHeader>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-[var(--body)]">
                <li>{confirmOff.partners.length ? `${partnersText(confirmOff.partners).replace(" may send it", "")} can no longer send ${confirmOff.name}.` : `No partner sends ${confirmOff.name} today.`}</li>
                <li>New leads, lead imports, forms and quotes stop offering it.</li>
                <li>{confirmOff.name} leads, applications and policies already in Insurvas keep working.</li>
              </ul>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmOff(null)}>Keep selling it</Button>
                <Button type="button" variant="destructive" onClick={() => { const row = confirmOff; setConfirmOff(null); void save(row, false); }}>Stop selling {confirmOff.name}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}
