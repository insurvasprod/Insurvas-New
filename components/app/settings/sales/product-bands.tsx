"use client";

/**
 * Settings › Quote & QA rules › Products with their own band (moved here 2026-10-27 from the Carrier
 * details product dialog; round 2026-10-30: added and changed in a dialog, removed after a question).
 * A product with a band is checked against it instead of the all-products band — the only way a
 * term product is checked at all. An Insurvas product gets the agency's own copy the first time its
 * band is set (saveProduct).
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { saveProduct } from "@/components/app/settings/carrier-card";
import { Field, SettingsTableCard, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { notify } from "@/lib/notify";
import type { CarrierProductView, CarriersPayload } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { RowAction, RowMenu } from "./shared";

type Row = { product: CarrierProductView; carrier: string };
type Band = { min: number; max: number } | null;
const BAND = /^\d{1,4}(\.\d{1,2})?$/;
const LINE: Record<string, string> = { final_expense: "Final expense", whole_life: "Whole life", term_life: "Term" };

/** Add (no `row`) or change one product's band. Nothing is saved until Save band. */
function BandDialog({ row, choices, agencyBand, onClose, onSaved }: { row: Row | null; choices: Row[]; agencyBand: Band; onClose: () => void; onSaved: () => Promise<void> }) {
  const [productId, setProductId] = useState(row?.product.id ?? "");
  const [min, setMin] = useState(row?.product.bandMin ?? "");
  const [max, setMax] = useState(row?.product.bandMax ?? "");
  const [busy, setBusy] = useState(false);
  const target = row ?? choices.find((r) => r.product.id === productId) ?? null;
  const bad = !BAND.test(min.trim()) || !BAND.test(max.trim()) ? "Write both ends as dollars, like 1.10." : Number(min) >= Number(max) ? "The lowest must be below the highest." : null;
  const touched = min !== (row?.product.bandMin ?? "") || max !== (row?.product.bandMax ?? "");

  async function save() {
    if (!target || bad) return;
    setBusy(true);
    const ok = await saveProduct(target.product, { bandMin: min.trim(), bandMax: max.trim() });
    setBusy(false);
    if (!ok) return;
    notify.done(`${target.product.name} band saved`);
    await onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? `${row.product.name} band` : "Give a product its own band"}</DialogTitle>
          <DialogDescription>
            Its quotes are checked against this band instead of the all-products one{agencyBand ? ` (${agencyBand.min.toFixed(2)}–${agencyBand.max.toFixed(2)})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {row ? (
            <p className="m-0 text-sm text-[var(--body)]">{row.carrier} · {LINE[row.product.productCode] ?? row.product.productCode}</p>
          ) : (
            <Field label="Product" htmlFor="band-product">
              <select id="band-product" className={control} value={productId} disabled={busy} onChange={(event) => setProductId(event.target.value)}>
                <option value="">Pick a product…</option>
                {choices.map((r) => <option key={r.product.id} value={r.product.id}>{r.product.name} · {r.carrier}</option>)}
              </select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lowest per $1,000" htmlFor="band-min" error={touched && bad ? bad : undefined}>
              <input id="band-min" className={cn(control, "tabular-nums")} inputMode="decimal" value={min} disabled={busy} aria-invalid={(touched && Boolean(bad)) || undefined} onChange={(event) => setMin(event.target.value)} />
            </Field>
            <Field label="Highest per $1,000" htmlFor="band-max">
              <input id="band-max" className={cn(control, "tabular-nums")} inputMode="decimal" value={max} disabled={busy} aria-invalid={(touched && Boolean(bad)) || undefined} onChange={(event) => setMax(event.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !target || Boolean(bad) || (row !== null && !touched)}>{busy ? "Saving…" : "Save band"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProductBands({ agencyBand }: { agencyBand: Band }) {
  const [data, setData] = useState<CarriersPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/app/settings/sales/carriers", { cache: "no-store" });
    if (!response.ok) { setFailed(true); return; }
    setFailed(false);
    setData((await response.json()) as CarriersPayload);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the card's external data, loaded once
  useEffect(() => { void load(); }, [load]);
  if (failed) return null;

  const all: Row[] = (data?.carriers ?? []).flatMap((carrier) => carrier.products.filter((p) => p.isActive).map((product) => ({ product, carrier: carrier.name })));
  const banded = all.filter((row) => row.product.bandMin && row.product.bandMax);
  const others = all.filter((row) => !(row.product.bandMin && row.product.bandMax));
  const canEdit = data?.canEdit ?? false;

  async function remove(row: Row) {
    const sure = await confirmAction({
      title: `Use the all-products band for ${row.product.name}?`,
      description: row.product.productCode === "term_life"
        ? "Term quotes are only checked against a product's own band, so its quotes will no longer be checked."
        : `Its quotes will be checked against ${agencyBand ? `${agencyBand.min.toFixed(2)}–${agencyBand.max.toFixed(2)}` : "the all-products band"} from now on.`,
      confirmLabel: "Remove band",
      cancelLabel: "Keep its band",
    });
    if (!sure) return;
    setBusy(row.product.id);
    const ok = await saveProduct(row.product, { bandMin: null, bandMax: null });
    setBusy(null);
    if (!ok) return;
    notify.done(`${row.product.name} uses the all-products band again`);
    await load();
  }

  return (
    <SettingsTableCard
      title="Products with their own band"
      actions={canEdit && others.length > 0 ? <Button type="button" variant="outline" onClick={() => setEditing("new")}>Add a product band</Button> : undefined}
    >
      {data === null ? <SectionLoading rows={2} columns={3} label="Loading your products" />
        : all.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="m-0 text-sm text-[var(--body)]">No products switched on yet.</p>
            <Button asChild variant="outline"><Link href="/app/settings#carriers">Open Contracting</Link></Button>
          </div>
        ) : banded.length === 0 ? (
          <p className="m-0 px-4 py-3 text-sm text-[var(--body)]">No product has its own band. Final expense and whole life use the band above; term quotes are not checked until their product has one.</p>
        ) : (
          <table className={st.table}>
            <thead><tr className={st.headRow}><th className={st.th}>Product</th><th className={st.th}>Type</th><th className={cn(st.th, "text-right")}>Band per $1,000</th><th className={st.th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {banded.map((row) => (
                <tr key={row.product.id}>
                  <td className={st.td}><span className={cn("block", st.strong)}>{row.product.name}</span><span className={st.sub}>{row.carrier}</span></td>
                  <td className={st.td}>{LINE[row.product.productCode] ?? row.product.productCode}</td>
                  <td className={cn(st.td, st.num, "text-[var(--ink)]")}>{row.product.bandMin} – {row.product.bandMax}</td>
                  <td className={cn(st.td, "text-right")}>
                    {canEdit && (
                      <span className="inline-flex items-center gap-1">
                        <RowAction label={`Change the band for ${row.product.name}`} disabled={busy !== null} onClick={() => setEditing(row)}>Change</RowAction>
                        <RowMenu label={row.product.name} items={[{ label: "Remove band", danger: true, disabled: busy !== null, onSelect: () => { void remove(row); } }]} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {editing && (
        <BandDialog
          key={editing === "new" ? "new" : editing.product.id}
          row={editing === "new" ? null : editing}
          choices={others}
          agencyBand={agencyBand}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </SettingsTableCard>
  );
}
