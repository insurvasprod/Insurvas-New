"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { PagedBody, PagedPager, PagedProvider, PagedTableCard } from "@/components/ui/paged";
import { bpToPercent, percentToBp, TRIGGER_LABELS } from "@/lib/ingestion/expectedCommission";
import type { RateCardCarrier } from "@/lib/ingestion/expectedCommissionStore";
import { fileDay } from "@/lib/ingestion/constants";
import { notify } from "@/lib/notify";

const whole = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const select = `${toolbarControl} w-full`;

/**
 * LA-4.13 (Notion sprint) · the rate card, carrier by carrier: what is set (pays on, lag, your
 * contract level, rates, product families), what is missing, and how much of the book that leaves
 * unchecked. Each change is saved, and the expected figures are worked out again straight away.
 */
export function RateCardWorkspace({ carriers, products, readOnly, today }: { carriers: RateCardCarrier[]; products: Array<{ code: string; name: string }>; readOnly: boolean; today: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const open = carriers.find((c) => c.carrierId === openId) ?? null;
  const productRows = open ? [...open.unmapped.map((u) => ({ code: u.code, family: "", note: `${u.policies} ${u.policies === 1 ? "policy" : "policies"}`, own: true })), ...open.mapped.map((m) => ({ code: m.code, family: m.family, note: m.own ? "yours" : "set by Insurvas", own: m.own }))] : [];
  const field = (key: string, fallback = "") => form[key] ?? fallback;
  const set = (key: string, value: string) => setForm((now) => ({ ...now, [key]: value }));

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/app/rate-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string; expected?: { inserted: number; filled: number } };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      const priced = (data.expected?.inserted ?? 0) + (data.expected?.filled ?? 0);
      notify.done(priced ? `${done} ${priced.toLocaleString("en-US")} expected ${priced === 1 ? "figure" : "figures"} worked out.` : done);
      setForm({});
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function saveRate() {
    if (!open) return;
    const rate = percentToBp(field("rate"));
    const level = percentToBp(field("rateLevel", open.levelBp !== null ? bpToPercent(open.levelBp) : ""));
    if (!field("family")) return notify.block("Choose the product family.");
    if (rate === null) return notify.block("Enter the rate as a percentage, like 145 or 82.5.");
    if (level === null) return notify.block("Enter the contract level the rate is for, like 100.");
    void post({ action: "save_rate", carrier_id: open.carrierId, product_code: field("family"), contract_level_bp: level, policy_year: Number(field("year", "1")) || 1, rate_bp: rate, effective_from: field("from", today), applies_onward: field("onward") === "yes" }, "Rate saved.");
  }

  function saveAdvanceRule() {
    if (!open) return;
    const family = field("advFamily", open.mapped[0]?.family ?? "");
    const months = Number(field("advMonths"));
    const pct = percentToBp(field("advPct"));
    const back = Number(field("advBack"));
    if (!family) return notify.block("Choose the product family.");
    if (!field("advMonths") || !Number.isInteger(months) || months < 0) return notify.block("Enter how many months are advanced, like 9.");
    if (pct === null) return notify.block("Enter the advance as a percentage of year one, like 75.");
    if (!field("advBack") || !Number.isInteger(back) || back < 0) return notify.block("Enter how many months it can be clawed back, like 12.");
    void post({ action: "save_advance_rule", carrier_id: open.carrierId, product_code: family, advance_months: months, advance_pct_bp: pct, clawback_months: back, clawback_type: field("advType", "prorated"), effective_from: field("advFrom", today) }, "Advance rule saved.");
  }

  return (
    <>
      <PagedTableCard total={carriers.length} noun="carriers" toolbar={<DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}><span className="text-sm text-muted-foreground">Largest monthly premium first</span></DataToolbar>}>
        {carriers.length === 0 ? (
          <EmptyState title="No policies from carrier files yet" hint="The rate card is set up per carrier you hold policies with. Import your book first." />
        ) : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr>
                <th className="min-w-[180px]">Carrier</th>
                <th className="w-[90px] text-right">Policies</th>
                <th className="w-[120px] text-right">Monthly premium</th>
                <th className="w-[150px]" title="When the carrier pays: on issue, or once the first premium drafts">Pays</th>
                <th className="w-[110px] text-right" title="Your contract level with the carrier">Your level</th>
                <th className="w-[80px] text-right">Rates</th>
                <th className="w-[170px]" title="Policies the rate card can price today">Can be checked</th>
                <th className="w-[96px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <PagedBody>
              {carriers.map((c) => {
                const share = c.monthlyCents ? Math.floor((c.pricedMonthlyCents * 100) / c.monthlyCents) : 0;
                return (
                  <tr key={c.carrierId}>
                    <td><span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{c.carrierName}</span></td>
                    <td className="text-right tabular-nums">{c.policies.toLocaleString("en-US")}</td>
                    <td className="text-right tabular-nums">{whole(c.monthlyCents)}</td>
                    <td>{c.trigger ? <>{TRIGGER_LABELS[c.trigger]}<span className="block text-xs text-muted-foreground">{c.lagDays !== null ? `usually within ${c.lagDays} days` : "lag not set"}</span></> : <span className="text-[var(--warning-ink)]">Not set</span>}</td>
                    <td className="text-right tabular-nums">{c.levelBp !== null ? `${bpToPercent(c.levelBp)}%` : <span className="text-[var(--warning-ink)]">Not set</span>}</td>
                    <td className="text-right tabular-nums">{c.schedules.length}</td>
                    <td>
                      {c.policies === 0 ? <span className="text-muted-foreground">No policies yet</span> : <>
                        <StatusChip tone={c.pricedPolicies === c.policies ? "good" : c.pricedPolicies ? "warning" : "danger"}>{c.pricedPolicies === c.policies ? "All" : c.pricedPolicies ? `${c.pricedPolicies} of ${c.policies}` : "None"}</StatusChip>
                        <span className="block text-xs text-muted-foreground">{share}% of premium</span>
                      </>}
                    </td>
                    <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => { setForm({}); setOpenId(c.carrierId); }}>{readOnly ? "Open" : c.policies > 0 && c.pricedPolicies === c.policies ? "Edit" : "Set up"}</Button></td>
                  </tr>
                );
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>

      <Dialog open={Boolean(open)} onOpenChange={(next) => { if (!next && !busy) setOpenId(null); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{open.carrierName}</DialogTitle>
                <DialogDescription>
                  {open.policies === 0 ? "No policy from this carrier in your files yet. What you set here prices them as they arrive" : <>{open.pricedPolicies} of {open.policies} policies can be checked</>}{open.reasons.length ? `. The rest: ${open.reasons.slice(0, 3).map((r) => `${r.reason} (${r.policies})`).join("; ")}.` : "."}
                </DialogDescription>
              </DialogHeader>

              <fieldset disabled={readOnly || busy} className="grid gap-5 text-sm">
                <section className="grid gap-2 border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 text-sm font-semibold text-foreground">Pays</h3>
                    <span className="text-xs text-muted-foreground">Set by Insurvas</span>
                  </div>
                  <p className="m-0 text-muted-foreground">{open.trigger ? `${TRIGGER_LABELS[open.trigger]}${open.lagDays !== null ? `, usually within ${open.lagDays} days` : ", with no usual lag set, so nothing is ever called overdue"}.` : "Not set: nothing is expected from this carrier until it is."}</p>
                </section>

                <section className="grid gap-2 border-t border-border pt-4">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Your contract level</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="grid gap-1"><Label htmlFor="rc-level">Level (%)</Label><Input id="rc-level" className="h-9" inputMode="decimal" placeholder="e.g. 100" value={field("level", open.levelBp !== null ? bpToPercent(open.levelBp) : "")} onChange={(e) => set("level", e.target.value)} /></div>
                    <div className="grid gap-1"><Label htmlFor="rc-writing">Writing number</Label><Input id="rc-writing" className="h-9" maxLength={120} value={field("writing", open.writingNumber ?? "")} onChange={(e) => set("writing", e.target.value)} /></div>
                    <div className="grid gap-1"><Label htmlFor="rc-level-from">Applies from</Label><Input id="rc-level-from" type="date" className="h-9" value={field("levelFrom", today)} onChange={(e) => set("levelFrom", e.target.value)} /></div>
                  </div>
                  <div><Button type="button" size="sm" onClick={() => { const level = percentToBp(field("level", open.levelBp !== null ? bpToPercent(open.levelBp) : "")); if (level === null) return notify.block("Enter your level as a percentage, like 100."); void post({ action: "save_level", carrier_id: open.carrierId, contract_level_bp: level, writing_number: field("writing", open.writingNumber ?? ""), effective_from: field("levelFrom", today) }, "Contract level saved."); }}>Save level</Button></div>
                </section>

                <section className="grid gap-2 border-t border-border pt-4">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Products in your book</h3>
                  {open.unmapped.length === 0 && open.mapped.length === 0 ? <p className="m-0 text-muted-foreground">The carrier&apos;s file names no product.</p> : (
                    <PagedProvider>
                    <PagedBody as="ul" className="m-0 grid list-none gap-2 p-0">
                      {productRows.map((row) => (
                        <li key={row.code} className="grid items-center gap-2 sm:grid-cols-[1fr_220px_auto]">
                          <span><span className="font-mono text-xs text-foreground">{row.code}</span> <span className="text-xs text-muted-foreground">· {row.note}</span></span>
                          <select aria-label={`Product family for ${row.code}`} className={select} value={field(`fam:${row.code}`, row.family)} onChange={(e) => set(`fam:${row.code}`, e.target.value)}>
                            <option value="">{row.family ? "Use Insurvas' match" : "Choose a product family"}</option>
                            {products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                          </select>
                          <Button type="button" size="sm" variant="outline" disabled={field(`fam:${row.code}`, row.family) === row.family} onClick={() => void post({ action: "map_product", carrier_id: open.carrierId, carrier_product_code: row.code, product_code: field(`fam:${row.code}`) || null }, "Product matched.")}>Save</Button>
                        </li>
                      ))}
                    </PagedBody>
                    {productRows.length > 10 && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><PagedPager total={productRows.length} noun="products" /></div>}
                    </PagedProvider>
                  )}
                </section>

                <section className="grid gap-2 border-t border-border pt-4">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Rates</h3>
                  {open.schedules.length > 0 && (
                    <PagedProvider>
                    <table className="w-full text-left text-sm">
                      <thead><tr className="text-xs text-muted-foreground"><th className="py-1 font-medium">Product family</th><th className="py-1 font-medium">Level</th><th className="py-1 font-medium">Year</th><th className="py-1 font-medium">Rate</th><th className="py-1 font-medium">From</th><th className="py-1 font-medium">Age bands</th></tr></thead>
                      <PagedBody>
                        {open.schedules.map((s) => (
                          <tr key={s.id} className="border-t border-border align-top">
                            <td className="py-1.5">{s.familyName}</td>
                            <td className="py-1.5 tabular-nums">{bpToPercent(s.levelBp)}%</td>
                            <td className="py-1.5 tabular-nums">{s.policyYear}{s.appliesOnward ? "+" : ""}</td>
                            <td className="py-1.5 font-semibold tabular-nums">{bpToPercent(s.rateBp)}%</td>
                            <td className="py-1.5 tabular-nums">{fileDay(s.effectiveFrom)}</td>
                            <td className="py-1.5">
                              {s.bands.map((b) => <span key={b.id} className="block text-xs">{b.ageMin}–{b.ageMax}: {bpToPercent(b.rateBp)}%</span>)}
                              {!readOnly && (
                                <span className="mt-1 inline-flex items-center gap-1">
                                  <Input aria-label="Band from age" className="h-8 w-14" inputMode="numeric" placeholder="80" value={field(`bmin:${s.id}`)} onChange={(e) => set(`bmin:${s.id}`, e.target.value.replace(/\D/g, ""))} />
                                  <Input aria-label="Band to age" className="h-8 w-14" inputMode="numeric" placeholder="85" value={field(`bmax:${s.id}`)} onChange={(e) => set(`bmax:${s.id}`, e.target.value.replace(/\D/g, ""))} />
                                  <Input aria-label="Band rate (%)" className="h-8 w-16" inputMode="decimal" placeholder="110" value={field(`brate:${s.id}`)} onChange={(e) => set(`brate:${s.id}`, e.target.value)} />
                                  <Button type="button" size="sm" variant="outline" disabled={!field(`bmin:${s.id}`) || !field(`bmax:${s.id}`) || !field(`brate:${s.id}`)} onClick={() => { const rate = percentToBp(field(`brate:${s.id}`)); if (rate === null) return notify.block("Enter the band's rate as a percentage."); void post({ action: "add_band", carrier_id: open.carrierId, schedule_id: s.id, age_min: Number(field(`bmin:${s.id}`)), age_max: Number(field(`bmax:${s.id}`)), rate_bp: rate }, "Age band added."); }}>Add band</Button>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </PagedBody>
                    </table>
                    {open.schedules.length > 10 && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><PagedPager total={open.schedules.length} noun="rates" /></div>}
                    </PagedProvider>
                  )}
                  <div className="grid gap-3 sm:grid-cols-6">
                    <div className="grid gap-1 sm:col-span-2">
                      <Label htmlFor="rc-family">Product family</Label>
                      <select id="rc-family" className={select} value={field("family", [...open.mapped.map((m) => m.family)][0] ?? "")} onChange={(e) => set("family", e.target.value)}>
                        <option value="">Choose</option>
                        {products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-1"><Label htmlFor="rc-year">Policy year</Label><Input id="rc-year" className="h-9" inputMode="numeric" value={field("year", "1")} onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} /></div>
                    <div className="grid gap-1"><Label htmlFor="rc-rate">Rate (%)</Label><Input id="rc-rate" className="h-9" inputMode="decimal" placeholder="e.g. 145" value={field("rate")} onChange={(e) => set("rate", e.target.value)} /></div>
                    <div className="grid gap-1"><Label htmlFor="rc-rate-level">For level (%)</Label><Input id="rc-rate-level" className="h-9" inputMode="decimal" value={field("rateLevel", open.levelBp !== null ? bpToPercent(open.levelBp) : "")} onChange={(e) => set("rateLevel", e.target.value)} /></div>
                    <div className="grid gap-1"><Label htmlFor="rc-from">From</Label><Input id="rc-from" type="date" className="h-9" value={field("from", today)} onChange={(e) => set("from", e.target.value)} /></div>
                  </div>
                  <label htmlFor="rc-onward" className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input id="rc-onward" type="checkbox" className="size-4 accent-[var(--primary)]" checked={field("onward") === "yes"} onChange={(e) => set("onward", e.target.checked ? "yes" : "")} />
                    Also every later year without its own rate (year {field("year", "1") || "N"}+)
                  </label>
                  <p className="m-0 text-xs text-muted-foreground">A rate applies from its date onward; figures already worked out never change.</p>
                  <div><Button type="button" size="sm" onClick={saveRate}>Add rate</Button></div>
                </section>

                <section className="grid gap-2 border-t border-border pt-4">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Advance rules</h3>
                  {open.advanceRules.length > 0 ? (
                    <PagedProvider>
                    <table className="w-full text-left text-sm">
                      <thead><tr className="text-xs text-muted-foreground"><th className="py-1 font-medium">Product family</th><th className="py-1 text-right font-medium">Advanced</th><th className="py-1 text-right font-medium">Of year one</th><th className="py-1 text-right font-medium">Clawback</th><th className="py-1 pl-4 font-medium">Type</th><th className="py-1 font-medium">From</th></tr></thead>
                      <PagedBody>
                        {open.advanceRules.map((r) => (
                          <tr key={`${r.productCode}|${r.effectiveFrom}`} className="border-t border-border">
                            <td className="py-1.5">{r.familyName}</td>
                            <td className="py-1.5 text-right tabular-nums">{r.advanceMonths} months</td>
                            <td className="py-1.5 text-right font-semibold tabular-nums">{bpToPercent(r.advancePctBp)}%</td>
                            <td className="py-1.5 text-right tabular-nums">{r.clawbackMonths} months</td>
                            <td className="py-1.5 pl-4">{r.clawbackType === "full" ? "Full" : "Prorated"}</td>
                            <td className="py-1.5 tabular-nums">{fileDay(r.effectiveFrom)}</td>
                          </tr>
                        ))}
                      </PagedBody>
                    </table>
                    {open.advanceRules.length > 10 && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><PagedPager total={open.advanceRules.length} noun="advance rules" /></div>}
                    </PagedProvider>
                  ) : <p className="m-0 text-muted-foreground">None yet: nothing is expected up front, and no lapse is counted as inside a clawback window.</p>}
                  <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
                    <div className="grid gap-1 sm:col-span-2">
                      <Label htmlFor="rc-adv-family">Product family</Label>
                      <select id="rc-adv-family" className={select} value={field("advFamily", open.mapped[0]?.family ?? "")} onChange={(e) => set("advFamily", e.target.value)}>
                        <option value="">Choose</option>
                        {products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-1"><Label htmlFor="rc-adv-months">Months</Label><Input id="rc-adv-months" className="h-9" inputMode="numeric" placeholder="e.g. 9" value={field("advMonths")} onChange={(e) => set("advMonths", e.target.value.replace(/\D/g, ""))} /></div>
                    <div className="grid gap-1"><Label htmlFor="rc-adv-pct">Advance (%)</Label><Input id="rc-adv-pct" className="h-9" inputMode="decimal" placeholder="e.g. 75" value={field("advPct")} onChange={(e) => set("advPct", e.target.value)} /></div>
                    <div className="grid gap-1"><Label htmlFor="rc-adv-back">Clawback (mo)</Label><Input id="rc-adv-back" className="h-9" inputMode="numeric" placeholder="e.g. 12" value={field("advBack")} onChange={(e) => set("advBack", e.target.value.replace(/\D/g, ""))} /></div>
                    <div className="grid gap-1">
                      <Label htmlFor="rc-adv-type">Type</Label>
                      <select id="rc-adv-type" className={select} value={field("advType", "prorated")} onChange={(e) => set("advType", e.target.value)}>
                        <option value="prorated">Prorated</option>
                        <option value="full">Full</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-6">
                    <div className="grid gap-1 sm:col-span-2"><Label htmlFor="rc-adv-from">From</Label><Input id="rc-adv-from" type="date" className="h-9" value={field("advFrom", today)} onChange={(e) => set("advFrom", e.target.value)} /></div>
                  </div>
                  <p className="m-0 text-xs text-muted-foreground">Prorated takes back only the months not yet earned; full takes the whole advance back if the policy lapses inside the window.</p>
                  <div><Button type="button" size="sm" onClick={saveAdvanceRule}>Save advance rule</Button></div>
                </section>
              </fieldset>

              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setOpenId(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
