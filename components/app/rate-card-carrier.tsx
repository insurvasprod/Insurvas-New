"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CheckBox } from "@/components/ui/check-box";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page-states";
import { RowAction, RowActionCell } from "@/components/ui/row-action";
import { SelectMenu } from "@/components/ui/select-menu";
import { TableCard } from "@/components/ui/table-card";
import { bpToPercent, percentToBp } from "@/lib/ingestion/expectedCommission";
import type { RateCardCarrier } from "@/lib/ingestion/expectedCommissionStore";
import { fileDay } from "@/lib/ingestion/constants";
import { notify } from "@/lib/notify";

/**
 * Rate card › one carrier (owner 2026-11-19, board ledger-r1 2·A): the carrier's terms as a page, not a pop-up.
 * Each thing is a table — Rates, Advances, Products in your book — and adding or editing happens in the table
 * itself: Add opens one new row at the top, Edit turns that row into its inputs. A save re-saves the row's own
 * key (carrier, product, level, year, date), so an edit replaces it; expected figures are worked out again.
 *
 * The first row for a product reaches back to the start (lib/ledger/compute.ts `inForceOn`), so a new rate's
 * date only matters once there is an earlier one; the From column says "From the start" for that first row.
 */
type Products = Array<{ code: string; name: string }>;
const TH = "text-xs font-medium text-muted-foreground";

export function RateCardCarrierEditor({ carrier, products, readOnly, today }: { carrier: RateCardCarrier; products: Products; readOnly: boolean; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch("/api/app/rate-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: carrier.carrierId, ...body }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string; expected?: { inserted: number; filled: number } };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      const priced = (data.expected?.inserted ?? 0) + (data.expected?.filled ?? 0);
      notify.done(priced ? `${done} ${priced.toLocaleString("en-US")} expected ${priced === 1 ? "figure" : "figures"} worked out.` : done);
      router.refresh();
      return true;
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const disabled = readOnly || busy;
  return (
    <>
      <LevelCard carrier={carrier} today={today} disabled={disabled} post={post} />
      <RatesCard carrier={carrier} products={products} today={today} disabled={disabled} post={post} />
      <AdvancesCard carrier={carrier} products={products} today={today} disabled={disabled} post={post} />
      <ProductsCard carrier={carrier} products={products} disabled={disabled} post={post} />
    </>
  );
}

type Post = (body: Record<string, unknown>, done: string) => Promise<boolean>;

function familyOptions(products: Products, empty: string) {
  return [{ value: "", label: empty }, ...products.map((p) => ({ value: p.code, label: p.name }))];
}

/** Your contract level and writing number: one line, edited in place. */
function LevelCard({ carrier, today, disabled, post }: { carrier: RateCardCarrier; today: string; disabled: boolean; post: Post }) {
  const [editing, setEditing] = useState(carrier.levelBp === null);
  const [level, setLevel] = useState(carrier.levelBp !== null ? bpToPercent(carrier.levelBp) : "100");
  const [writing, setWriting] = useState(carrier.writingNumber ?? "");
  async function save() {
    const bp = percentToBp(level);
    if (bp === null) return notify.block("Enter your level as a percentage, like 100.");
    if (await post({ action: "save_level", contract_level_bp: bp, writing_number: writing, effective_from: today }, "Contract level saved.")) setEditing(false);
  }
  return (
    <TableCard
      title="Your contract"
      description="What share of the carrier's commission you get, and your writing number with them"
      action={!editing && !disabled ? <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button> : undefined}
    >
      {editing ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-border px-4 py-3">
          <label className="grid gap-1 text-sm"><span className={TH}>Level (%)</span><Input className="w-28" inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} disabled={disabled} /></label>
          <label className="grid gap-1 text-sm"><span className={TH}>Writing number</span><Input className="w-56" maxLength={120} value={writing} onChange={(e) => setWriting(e.target.value)} disabled={disabled} /></label>
          <Button type="button" size="sm" onClick={() => void save()} disabled={disabled}>Save</Button>
          {carrier.levelBp !== null && <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={disabled}>Cancel</Button>}
        </div>
      ) : (
        <dl className="m-0 flex flex-wrap gap-x-10 gap-y-2 border-t border-border px-4 py-3 text-sm">
          <div><dt className={TH}>Level</dt><dd className="m-0 font-semibold tabular-nums text-foreground">{carrier.levelBp !== null ? `${bpToPercent(carrier.levelBp)}%` : "Not set"}</dd></div>
          <div><dt className={TH}>Writing number</dt><dd className="m-0 font-semibold text-foreground">{carrier.writingNumber ?? "—"}</dd></div>
        </dl>
      )}
    </TableCard>
  );
}

type RateDraft = { family: string; year: string; rate: string; level: string; from: string; onward: boolean };

function RatesCard({ carrier, products, today, disabled, post }: { carrier: RateCardCarrier; products: Products; today: string; disabled: boolean; post: Post }) {
  const level = carrier.levelBp !== null ? bpToPercent(carrier.levelBp) : "100";
  const blank: RateDraft = { family: carrier.mapped[0]?.family ?? "", year: "1", rate: "", level, from: today, onward: false };
  const [adding, setAdding] = useState<RateDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<RateDraft | null>(null);
  const [band, setBand] = useState({ min: "", max: "", rate: "" });
  // "From the start": the earliest row for its product and year reaches back (inForceOn).
  const firstOf = new Map<string, string>();
  for (const s of carrier.schedules) {
    const key = `${s.productCode}|${s.levelBp}|${s.policyYear}`;
    const was = firstOf.get(key);
    if (!was || s.effectiveFrom < was) firstOf.set(key, s.effectiveFrom);
  }

  async function save(draft: RateDraft, done: string) {
    const rate = percentToBp(draft.rate);
    const lvl = percentToBp(draft.level);
    if (!draft.family) { notify.block("Choose the product."); return false; }
    if (rate === null) { notify.block("Enter the rate as a percentage, like 100 or 82.5."); return false; }
    if (lvl === null) { notify.block("Enter the level the rate is for, like 100."); return false; }
    return post({ action: "save_rate", product_code: draft.family, contract_level_bp: lvl, policy_year: Number(draft.year) || 1, rate_bp: rate, effective_from: draft.from || today, applies_onward: draft.onward }, done);
  }

  const draftRow = (draft: RateDraft, setDraft: (next: RateDraft) => void, onSave: () => void, onCancel: () => void, fixedKey: boolean) => (
    <tr className="bg-[var(--color-card)]">
      <td>{fixedKey ? <span className="font-medium text-foreground">{products.find((p) => p.code === draft.family)?.name ?? draft.family}</span> : <SelectMenu label="Product" className="w-full" matchTriggerWidth disabled={disabled} value={draft.family} options={familyOptions(products, "Choose")} onChange={(value) => setDraft({ ...draft, family: value })} />}</td>
      <td>{fixedKey ? <span className="tabular-nums">{draft.year}</span> : <Input aria-label="Policy year" className="w-16" inputMode="numeric" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value.replace(/\D/g, "") })} disabled={disabled} />}</td>
      <td><Input aria-label="Rate (%)" className="w-20" inputMode="decimal" placeholder="100" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} disabled={disabled} autoFocus /></td>
      <td>{fixedKey ? <span className="tabular-nums">{draft.level}%</span> : <Input aria-label="For level (%)" className="w-20" inputMode="decimal" value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })} disabled={disabled} />}</td>
      <td>{fixedKey ? <span className="tabular-nums text-muted-foreground">{fileDay(draft.from)}</span> : <Input aria-label="From" type="date" className="w-[9.5rem]" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} disabled={disabled} />}</td>
      <td>
        <label className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground"><CheckBox checked={draft.onward} onChange={(e) => setDraft({ ...draft, onward: e.target.checked })} disabled={disabled} />Later years too</label>
      </td>
      <td className="w-px whitespace-nowrap text-right">
        <span className="inline-flex gap-2"><Button type="button" size="xs" onClick={onSave} disabled={disabled}>Save</Button><Button type="button" size="xs" variant="outline" onClick={onCancel} disabled={disabled}>Cancel</Button></span>
      </td>
    </tr>
  );

  return (
    <TableCard
      title="Rates"
      description="What the carrier pays you per product and policy year, at your level"
      action={!disabled && !adding ? <Button type="button" size="sm" onClick={() => { setEditId(null); setAdding(blank); }}>Add Rate</Button> : undefined}
    >
      {carrier.schedules.length === 0 && !adding ? (
        <EmptyState title="No rates yet" hint="Add the rate for each product you sell with this carrier, and every policy's expected commission is worked out." />
      ) : (
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr><th className="min-w-[140px]">Product</th><th className="w-[80px]">Year</th><th className="w-[100px]">Rate</th><th className="w-[100px]">At level</th><th className="w-[150px]">From</th><th>Age bands</th><th /></tr>
          </thead>
          <tbody>
            {adding && draftRow(adding, setAdding, () => void save(adding, "Rate added.").then((ok) => ok && setAdding(null)), () => setAdding(null), false)}
            {carrier.schedules.map((s) => {
              if (editId === s.id && edit) {
                return (
                  <Fragment key={s.id}>
                    {draftRow(edit, setEdit, () => void save(edit, "Rate saved.").then((ok) => ok && setEditId(null)), () => setEditId(null), true)}
                    <tr className="bg-[var(--color-card)]">
                      <td colSpan={7}>
                        <span className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Add an age band:</span>
                          <Input aria-label="Band from age" className="w-16" inputMode="numeric" placeholder="80" value={band.min} onChange={(e) => setBand({ ...band, min: e.target.value.replace(/\D/g, "") })} disabled={disabled} />
                          <span className="text-muted-foreground">to</span>
                          <Input aria-label="Band to age" className="w-16" inputMode="numeric" placeholder="85" value={band.max} onChange={(e) => setBand({ ...band, max: e.target.value.replace(/\D/g, "") })} disabled={disabled} />
                          <span className="text-muted-foreground">pays</span>
                          <Input aria-label="Band rate (%)" className="w-20" inputMode="decimal" placeholder="50" value={band.rate} onChange={(e) => setBand({ ...band, rate: e.target.value })} disabled={disabled} />
                          <span className="text-muted-foreground">%</span>
                          <Button type="button" size="xs" variant="outline" disabled={disabled || !band.min || !band.max || !band.rate} onClick={() => { const rate = percentToBp(band.rate); if (rate === null) return notify.block("Enter the band's rate as a percentage."); void post({ action: "add_band", schedule_id: s.id, age_min: Number(band.min), age_max: Number(band.max), rate_bp: rate }, "Age band added.").then((ok) => ok && setBand({ min: "", max: "", rate: "" })); }}>Add Band</Button>
                        </span>
                      </td>
                    </tr>
                  </Fragment>
                );
              }
              const first = firstOf.get(`${s.productCode}|${s.levelBp}|${s.policyYear}`) === s.effectiveFrom;
              return (
                <tr key={s.id}>
                  <td className="whitespace-nowrap font-medium text-foreground">{s.familyName}</td>
                  <td className="tabular-nums">{s.policyYear}{s.appliesOnward ? "+" : ""}</td>
                  <td className="tabular-nums">{bpToPercent(s.rateBp)}%</td>
                  <td className="tabular-nums">{bpToPercent(s.levelBp)}%</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground" title={first ? `Saved from ${fileDay(s.effectiveFrom)}; as your first rate it also covers earlier policies` : undefined}>{first ? "From the start" : fileDay(s.effectiveFrom)}</td>
                  <td className="whitespace-nowrap tabular-nums">{s.bands.length ? s.bands.map((b) => `${b.ageMin}–${b.ageMax}: ${bpToPercent(b.rateBp)}%`).join(", ") : <span className="text-muted-foreground">—</span>}</td>
                  {disabled ? <td /> : <RowActionCell><RowAction title={`Edit ${s.familyName}, year ${s.policyYear}`} onClick={() => { setAdding(null); setBand({ min: "", max: "", rate: "" }); setEdit({ family: s.productCode, year: String(s.policyYear), rate: bpToPercent(s.rateBp), level: bpToPercent(s.levelBp), from: s.effectiveFrom, onward: s.appliesOnward }); setEditId(s.id); }}>Edit</RowAction></RowActionCell>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

type AdvanceDraft = { family: string; months: string; pct: string; back: string; type: "prorated" | "full"; from: string };

function AdvancesCard({ carrier, products, today, disabled, post }: { carrier: RateCardCarrier; products: Products; today: string; disabled: boolean; post: Post }) {
  const blank: AdvanceDraft = { family: carrier.mapped[0]?.family ?? "", months: "9", pct: "75", back: "12", type: "prorated", from: today };
  const [adding, setAdding] = useState<AdvanceDraft | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [edit, setEdit] = useState<AdvanceDraft | null>(null);
  const firstRule = new Map<string, string>();
  for (const r of carrier.advanceRules) {
    const was = firstRule.get(r.productCode);
    if (!was || r.effectiveFrom < was) firstRule.set(r.productCode, r.effectiveFrom);
  }

  async function save(draft: AdvanceDraft, done: string) {
    const months = Number(draft.months);
    const pct = percentToBp(draft.pct);
    const back = Number(draft.back);
    if (!draft.family) { notify.block("Choose the product."); return false; }
    if (!draft.months || !Number.isInteger(months) || months < 0) { notify.block("Enter how many months are advanced, like 9."); return false; }
    if (pct === null) { notify.block("Enter the advance as a percentage of year one, like 75."); return false; }
    if (!draft.back || !Number.isInteger(back) || back < 0) { notify.block("Enter how many months it can be taken back, like 12."); return false; }
    return post({ action: "save_advance_rule", product_code: draft.family, advance_months: months, advance_pct_bp: pct, clawback_months: back, clawback_type: draft.type, effective_from: draft.from || today }, done);
  }

  const draftRow = (key: string, draft: AdvanceDraft, setDraft: (next: AdvanceDraft) => void, onSave: () => void, onCancel: () => void, fixedKey: boolean) => (
    <tr key={key} className="bg-[var(--color-card)]">
      <td>{fixedKey ? <span className="font-medium text-foreground">{products.find((p) => p.code === draft.family)?.name ?? draft.family}</span> : <SelectMenu label="Product" className="w-full" matchTriggerWidth disabled={disabled} value={draft.family} options={familyOptions(products, "Choose")} onChange={(value) => setDraft({ ...draft, family: value })} />}</td>
      <td><span className="inline-flex items-center gap-1.5"><Input aria-label="Advance (%)" className="w-16" inputMode="decimal" value={draft.pct} onChange={(e) => setDraft({ ...draft, pct: e.target.value })} disabled={disabled} /><span className="text-muted-foreground">% ·</span><Input aria-label="Months advanced" className="w-14" inputMode="numeric" value={draft.months} onChange={(e) => setDraft({ ...draft, months: e.target.value.replace(/\D/g, "") })} disabled={disabled} /><span className="text-muted-foreground">mo</span></span></td>
      <td><span className="inline-flex items-center gap-1.5"><Input aria-label="Clawback months" className="w-14" inputMode="numeric" value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value.replace(/\D/g, "") })} disabled={disabled} /><span className="text-muted-foreground">mo</span></span></td>
      <td><SelectMenu label="Clawback type" className="w-32" matchTriggerWidth disabled={disabled} value={draft.type} options={[{ value: "prorated", label: "Prorated" }, { value: "full", label: "Full" }]} onChange={(value) => setDraft({ ...draft, type: value as AdvanceDraft["type"] })} /></td>
      <td>{fixedKey ? <span className="tabular-nums text-muted-foreground">{fileDay(draft.from)}</span> : <Input aria-label="From" type="date" className="w-[9.5rem]" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} disabled={disabled} />}</td>
      <td className="w-px whitespace-nowrap text-right"><span className="inline-flex gap-2"><Button type="button" size="xs" onClick={onSave} disabled={disabled}>Save</Button><Button type="button" size="xs" variant="outline" onClick={onCancel} disabled={disabled}>Cancel</Button></span></td>
    </tr>
  );

  return (
    <TableCard
      title="Advances"
      description="How much of year one the carrier pays up front, and for how long it can take it back"
      action={!disabled && !adding ? <Button type="button" size="sm" variant="outline" onClick={() => { setEditKey(null); setAdding(blank); }}>Add Advance</Button> : undefined}
    >
      {carrier.advanceRules.length === 0 && !adding ? (
        <EmptyState title="No advance" hint="Nothing is expected up front, and no lapse is counted as inside a clawback window." />
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead><tr><th className="min-w-[140px]">Product</th><th className="w-[180px]">Advanced</th><th className="w-[120px]">Clawback</th><th className="w-[140px]">Type</th><th className="w-[150px]">From</th><th /></tr></thead>
          <tbody>
            {adding && draftRow("new", adding, setAdding, () => void save(adding, "Advance added.").then((ok) => ok && setAdding(null)), () => setAdding(null), false)}
            {carrier.advanceRules.map((r) => {
              const key = `${r.productCode}|${r.effectiveFrom}`;
              if (editKey === key && edit) return draftRow(key, edit, setEdit, () => void save(edit, "Advance saved.").then((ok) => ok && setEditKey(null)), () => setEditKey(null), true);
              return (
                <tr key={key}>
                  <td className="whitespace-nowrap font-medium text-foreground">{r.familyName}</td>
                  <td className="whitespace-nowrap tabular-nums">{bpToPercent(r.advancePctBp)}% · {r.advanceMonths} mo</td>
                  <td className="whitespace-nowrap tabular-nums">{r.clawbackMonths} mo</td>
                  <td>{r.clawbackType === "full" ? "Full" : "Prorated"}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground" title={firstRule.get(r.productCode) === r.effectiveFrom ? `Saved from ${fileDay(r.effectiveFrom)}; as the first rule it also covers earlier policies` : undefined}>{firstRule.get(r.productCode) === r.effectiveFrom ? "From the start" : fileDay(r.effectiveFrom)}</td>
                  {disabled ? <td /> : <RowActionCell><RowAction title={`Edit the ${r.familyName} advance`} onClick={() => { setAdding(null); setEdit({ family: r.productCode, months: String(r.advanceMonths), pct: bpToPercent(r.advancePctBp), back: String(r.clawbackMonths), type: r.clawbackType, from: r.effectiveFrom }); setEditKey(key); }}>Edit</RowAction></RowActionCell>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/** The carrier's product names in your book, each matched to a product family; a change saves on its own row. */
function ProductsCard({ carrier, products, disabled, post }: { carrier: RateCardCarrier; products: Products; disabled: boolean; post: Post }) {
  const rows = [
    ...carrier.unmapped.map((u) => ({ code: u.code, family: "", note: `${u.policies} ${u.policies === 1 ? "policy" : "policies"}, not matched` })),
    ...carrier.mapped.map((m) => ({ code: m.code, family: m.family, note: m.own ? "matched by you" : "matched by Insurvas" })),
  ];
  const [picked, setPicked] = useState<Record<string, string>>({});
  return (
    <TableCard title="Products in your book" description="Which product each of the carrier's names is, so the right rate applies">
      {rows.length === 0 ? (
        <EmptyState title="No products yet" hint="The carrier's product names appear here as your policies and statements name them." />
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead><tr><th className="min-w-[200px]">The carrier calls it</th><th className="w-[260px]">Is</th><th>Matched</th><th /></tr></thead>
          <tbody>
            {rows.map((row) => {
              const value = picked[row.code] ?? row.family;
              return (
                <tr key={row.code}>
                  <td className="whitespace-nowrap font-medium text-foreground">&ldquo;{row.code}&rdquo;</td>
                  <td><SelectMenu label={`Product for ${row.code}`} className="w-full" matchTriggerWidth disabled={disabled} value={value} options={familyOptions(products, row.family ? "Use Insurvas' match" : "Choose a product")} onChange={(next) => setPicked((now) => ({ ...now, [row.code]: next }))} /></td>
                  <td className={row.family ? "text-muted-foreground" : "text-[var(--warning-ink)]"}>{row.note}</td>
                  <td className="w-px whitespace-nowrap text-right">{value !== row.family && <Button type="button" size="xs" disabled={disabled} onClick={() => void post({ action: "map_product", carrier_product_code: row.code, product_code: value || null }, "Product matched.")}>Save</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
