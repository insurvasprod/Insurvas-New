"use client";

/**
 * Settings › Quote & QA rules › Products with their own band (moved here 2026-10-27 from the Carrier
 * details product dialog). A product with a band is checked against it instead of the all-products
 * band. An Insurvas product gets the agency's own copy the first time its band is set (saveProduct).
 */

import { useCallback, useEffect, useState } from "react";

import { saveProduct } from "@/components/app/settings/carrier-card";
import { SettingsTableCard, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { CarrierProductView, CarriersPayload } from "@/lib/salesSettings/views";

type Row = { product: CarrierProductView; carrier: string };
const BAND = /^\d{1,4}(\.\d{1,2})?$/;

function BandRow({ row, canEdit, onSaved, onDrop }: { row: Row; canEdit: boolean; onSaved: () => Promise<void>; /** A row not saved yet is dropped, not cleared. */ onDrop?: () => void }) {
  const [min, setMin] = useState(row.product.bandMin ?? "");
  const [max, setMax] = useState(row.product.bandMax ?? "");
  const [busy, setBusy] = useState(false);
  const bad = !BAND.test(min.trim()) || !BAND.test(max.trim()) ? "Write both ends as dollars, like 1.10." : Number(min) >= Number(max) ? "The lowest must be below the highest." : null;
  const changed = min.trim() !== (row.product.bandMin ?? "") || max.trim() !== (row.product.bandMax ?? "");

  async function save(next: { bandMin: string | null; bandMax: string | null }, done: string) {
    setBusy(true);
    const ok = await saveProduct(row.product, next);
    setBusy(false);
    if (!ok) return;
    notify.done(done);
    await onSaved();
  }

  return (
    <tr>
      <td className={st.td}><span className="block text-sm font-semibold text-[var(--ink)]">{row.product.name}</span><span className="block text-xs text-[var(--muted)]">{row.carrier}</span></td>
      <td className={st.td}><input aria-label={`Lowest per $1,000 for ${row.product.name}`} className={cn(control, "mt-0 w-28 tabular-nums")} inputMode="decimal" value={min} disabled={!canEdit || busy} aria-invalid={(changed && Boolean(bad)) || undefined} onChange={(event) => setMin(event.target.value)} /></td>
      <td className={st.td}><input aria-label={`Highest per $1,000 for ${row.product.name}`} className={cn(control, "mt-0 w-28 tabular-nums")} inputMode="decimal" value={max} disabled={!canEdit || busy} aria-invalid={(changed && Boolean(bad)) || undefined} onChange={(event) => setMax(event.target.value)} /></td>
      <td className={cn(st.td, "text-right")}>
        {canEdit && (
          <span className="inline-flex items-center gap-2">
            {changed && bad && <span className="text-xs text-[var(--error-ink)]">{bad}</span>}
            {changed && <Button type="button" size="sm" disabled={busy || Boolean(bad)} onClick={() => void save({ bandMin: min.trim(), bandMax: max.trim() }, `${row.product.name} band saved`)}>Save</Button>}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => (onDrop ? onDrop() : void save({ bandMin: null, bandMax: null }, `${row.product.name} uses the all-products band again`))}>Remove</Button>
          </span>
        )}
      </td>
    </tr>
  );
}

export function ProductBands() {
  const [data, setData] = useState<CarriersPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState("");
  const [pending, setPending] = useState<Row | null>(null);
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
  const others = all.filter((row) => !(row.product.bandMin && row.product.bandMax) && row.product.id !== pending?.product.id);
  const rows = pending && !banded.some((row) => row.product.id === pending.product.id) ? [...banded, pending] : banded;
  const canEdit = data?.canEdit ?? false;

  function add() {
    const row = others.find((r) => r.product.id === adding);
    if (!row) return;
    // Nothing is saved until both ends are typed and Save is pressed.
    setPending(row);
    setAdding("");
  }

  return (
    <SettingsTableCard
      title="Products with their own band"
      actions={canEdit && others.length > 0 ? (
        <span className="flex items-center gap-2">
          <select aria-label="Product to give its own band" className={cn(control, "mt-0 w-56")} value={adding} onChange={(event) => setAdding(event.target.value)}>
            <option value="">Pick a product…</option>
            {others.map((row) => <option key={row.product.id} value={row.product.id}>{row.product.name} · {row.carrier}</option>)}
          </select>
          <Button type="button" variant="outline" disabled={!adding} onClick={add}>Add a product band</Button>
        </span>
      ) : undefined}
    >
      {data === null ? <p className="m-0 px-4 py-3 text-sm text-[var(--muted)]">Loading your products…</p>
        : rows.length === 0 ? <p className="m-0 px-4 py-3 text-sm text-[var(--muted)]">No product has its own band. Every product you sell uses the all-products band above.</p>
          : (
            <table className={st.table}>
              <thead><tr><th className={st.th}>Product</th><th className={st.th}>Lowest per $1,000</th><th className={st.th}>Highest per $1,000</th><th className={st.th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{rows.map((row) => <BandRow key={`${row.product.id}-${row.product.bandMin}-${row.product.bandMax}`} row={row} canEdit={canEdit} onSaved={async () => { setPending(null); await load(); }} onDrop={row === pending ? () => setPending(null) : undefined} />)}</tbody>
            </table>
          )}
    </SettingsTableCard>
  );
}
