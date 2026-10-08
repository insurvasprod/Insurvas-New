"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarCheckbox, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { CADENCES, COMMISSION_TRIGGERS, RULE_SOURCE_LABELS, RULE_SOURCES, RULE_TYPE_LABELS, RULE_TYPES, STATEMENT_FORMATS, type ResolvedRule, type RuleSource, type RuleType } from "@/lib/ingestion/carrierRules";
import type { CarrierRulesRow } from "@/lib/ingestion/carrierRulesStore";
import { fileDay } from "@/lib/ingestion/constants";
import { notify } from "@/lib/notify";

const select = `${toolbarControl} w-full`;
const TRIGGER_LABEL = { on_issue: "On issue", on_first_draft: "On first draft" } as const;
const CADENCE_LABEL = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", ad_hoc: "Now and then" } as const;

/** A carrier setting at a glance: its value and whose it is, or "Not set". */
function settingCell(setting: { value: string | number | null; scope: "agency" | "platform" | null }, labels: Record<string, string>) {
  if (setting.value === null) return <span className="text-muted-foreground">Not set</span>;
  return <span className="block leading-snug">{labels[String(setting.value)] ?? String(setting.value)}<span className="block text-xs text-muted-foreground">{setting.scope === "agency" ? "yours" : "platform"}</span></span>;
}
const FORMAT_LABEL = { spreadsheet: "Spreadsheet", pdf: "PDF" } as const;

function ruleCell(rule: ResolvedRule | null) {
  if (!rule || rule.windowDays === null) {
    return <span className="text-muted-foreground">{rule?.graceDays !== null && rule?.graceDays !== undefined ? `Grace ${rule.graceDays} d, no window` : <span title="Not set">—</span>}</span>;
  }
  return (
    <span title={`${rule.scope === "agency" ? "This agency's own rule" : "The platform's rule"} · ${rule.source ? RULE_SOURCE_LABELS[rule.source] : ""} · from ${rule.effectiveFrom}${rule.notes ? ` · ${rule.notes}` : ""}`}>
      <span className="font-semibold text-foreground tabular-nums">{rule.windowDays} days</span>
      <span className={`block text-xs ${rule.verified ? "text-muted-foreground" : "text-[var(--warning-ink)]"}`}>{rule.scope === "agency" ? "yours" : "platform"} · {rule.verified ? "verified" : "unverified"}</span>
    </span>
  );
}

const dollars = (cents: number | string | null) => (cents === null || cents === "" ? "" : (Number(cents) / 100).toFixed(2));
const toCents = (value: string) => (value.trim() === "" ? null : Math.round(Number(value) * 100));
const toInt = (value: string) => (value.trim() === "" ? null : Number(value));

/**
 * LA-4.17 (Notion sprint) · every carrier's rules in one place: how long it gives to save a policy,
 * its grace and redrafts, when commission triggers, the payout minimum and tolerance, and how its
 * files arrive. A missing rule is shown missing — with how many in-force policies it leaves without
 * a countdown — and an unverified one is shown unverified.
 */
export function CarrierRulesWorkspace({ carriers, plane, endpoint, readOnly, asOf }: { carriers: CarrierRulesRow[]; plane: "agency" | "platform"; endpoint: string; readOnly: boolean; asOf: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const visible = useMemo(() => carriers.filter((row) => (!query.trim() || row.carrierName.toLowerCase().includes(query.trim().toLowerCase())) && (!gapsOnly || row.gaps.length > 0)), [carriers, query, gapsOnly]);
  const open = carriers.find((row) => row.carrierId === openId) ?? null;

  async function post(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      setEditing(null);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  const draft = (key: string) => drafts[key] ?? {};
  const setDraft = (key: string, field: string, value: string) => setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? {}), [field]: value } }));

  return (
    <>
      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(query.trim() || gapsOnly) && <ClearFiltersButton onClick={() => { setQuery(""); setGapsOnly(false); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Search carriers" />
            <ToolbarCheckbox checked={gapsOnly} onChange={setGapsOnly} label="Only carriers with a missing rule" />
          </DataToolbar>
        }
      >
        {carriers.length === 0 ? (
          <EmptyState title="No carriers in the library" hint="Carriers come from the platform's carrier library." />
        ) : visible.length === 0 ? (
          <NoMatches noun="carriers" onClear={() => { setQuery(""); setGapsOnly(false); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[180px]">Carrier</th>
                {RULE_TYPES.map((type) => <th key={type} className="w-[108px]" style={{ whiteSpace: "normal" }} title={`Days the carrier gives: its ${RULE_TYPE_LABELS[type].window}`}>{RULE_TYPE_LABELS[type].label}</th>)}
                <th className="w-[110px]" title="When the carrier pays commission (expected commission waits for it)">Pays</th>
                <th className="w-[110px]" title="How often its files arrive: the file monitor flags a file that doesn't come">Files</th>
                {plane === "agency" && <th className="w-[80px] text-right" title="Policies in force with this carrier">In force</th>}
                <th className="w-[80px] text-right" title="Rules not set yet; hover a number to see which">Missing</th>
                <th className="w-[76px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.carrierId}>
                  <td><span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{row.carrierName}</span></td>
                  {RULE_TYPES.map((type) => <td key={type}>{ruleCell(row.rules[type])}</td>)}
                  <td>{settingCell(row.settings.commissionTrigger, TRIGGER_LABEL)}</td>
                  <td>{settingCell(row.settings.expectedCadence, CADENCE_LABEL)}</td>
                  {plane === "agency" && <td className="text-right tabular-nums">{(row.inForce ?? 0).toLocaleString("en-US")}</td>}
                  <td className={`text-right tabular-nums ${row.gaps.length ? "text-[var(--warning-ink)]" : "text-muted-foreground"}`} title={row.gaps.map((gap) => gap.sentence).join("\n")}>{row.gaps.length}</td>
                  <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => { setEditing(null); setOpenId(row.carrierId); }}>{readOnly ? "Open" : "Edit"}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={Boolean(open)} onOpenChange={(next) => { if (!next && !busy) setOpenId(null); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{open.carrierName}</DialogTitle>
                <DialogDescription>{plane === "agency" ? "Your rules override the platform's. A change applies from its date; past countdowns keep the rule they used." : "The platform's defaults, for every agency without its own rule."}</DialogDescription>
              </DialogHeader>


              <fieldset disabled={readOnly || busy !== null} className="grid gap-4 text-sm">
                {RULE_TYPES.map((type) => {
                  const rule = open.rules[type];
                  const key = `${open.carrierId}:${type}`;
                  const d = draft(key);
                  return (
                    <section key={type} className="grid gap-2 border-t border-border pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="m-0 text-sm font-semibold text-foreground">{RULE_TYPE_LABELS[type].label}</h3>
                          <span className={`text-xs ${rule ? "text-muted-foreground" : "text-[var(--warning-ink)]"}`}>
                            {rule ? `${rule.windowDays ?? "—"} day window${rule.graceDays !== null ? `, ${rule.graceDays} day grace` : ""} · ${rule.scope === "agency" ? "yours" : "platform"} · ${rule.source ? RULE_SOURCE_LABELS[rule.source].toLowerCase() : ""} · ${rule.verified ? "verified" : "unverified"} · from ${fileDay(rule.effectiveFrom)}` : `Not set: no countdown for the ${RULE_TYPE_LABELS[type].window}`}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {rule && !rule.verified && (rule.scope === plane) && <Button type="button" variant="outline" size="sm" onClick={() => void post(`${key}-v`, { action: "verify", rule_id: rule.id }, "Rule marked verified.")}>Mark verified</Button>}
                          {plane === "agency" && rule?.scope === "agency" && <Button type="button" variant="outline" size="sm" onClick={() => void post(`${key}-c`, { action: "clear_override", carrier_id: open.carrierId, rule_type: type }, "Back to the platform's rule.")}>Use the platform&apos;s rule</Button>}
                          {!readOnly && editing !== key && <Button type="button" variant="outline" size="sm" onClick={() => setEditing(key)}>{rule ? "Change" : "Set"}</Button>}
                        </div>
                      </div>
                      {editing === key && (<>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="grid gap-1"><Label htmlFor={`${key}-w`}>Window (days)</Label><Input id={`${key}-w`} className="h-9" inputMode="numeric" value={d.window ?? ""} onChange={(e) => setDraft(key, "window", e.target.value.replace(/\D/g, ""))} /></div>
                        <div className="grid gap-1"><Label htmlFor={`${key}-g`}>Grace (days)</Label><Input id={`${key}-g`} className="h-9" inputMode="numeric" value={d.grace ?? ""} onChange={(e) => setDraft(key, "grace", e.target.value.replace(/\D/g, ""))} /></div>
                        <div className="grid gap-1"><Label htmlFor={`${key}-r`}>Redraft attempts</Label><Input id={`${key}-r`} className="h-9" inputMode="numeric" value={d.redrafts ?? ""} onChange={(e) => setDraft(key, "redrafts", e.target.value.replace(/\D/g, ""))} /></div>
                        <div className="grid gap-1"><Label htmlFor={`${key}-i`}>Days between redrafts</Label><Input id={`${key}-i`} className="h-9" inputMode="numeric" value={d.interval ?? ""} onChange={(e) => setDraft(key, "interval", e.target.value.replace(/\D/g, ""))} /></div>
                        <div className="grid gap-1">
                          <Label htmlFor={`${key}-s`}>Where it comes from</Label>
                          <select id={`${key}-s`} className={select} value={d.source ?? ""} onChange={(e) => setDraft(key, "source", e.target.value)}>
                            <option value="">Choose</option>
                            {RULE_SOURCES.map((source) => <option key={source} value={source}>{RULE_SOURCE_LABELS[source]}</option>)}
                          </select>
                        </div>
                        <div className="grid gap-1"><Label htmlFor={`${key}-f`}>Applies from</Label><Input id={`${key}-f`} type="date" className="h-9" value={d.from ?? asOf} onChange={(e) => setDraft(key, "from", e.target.value)} /></div>
                        <div className="grid gap-1 sm:col-span-2"><Label htmlFor={`${key}-n`}>Notes</Label><Input id={`${key}-n`} className="h-9" maxLength={1000} value={d.notes ?? ""} onChange={(e) => setDraft(key, "notes", e.target.value)} /></div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                        <Button type="button" size="sm" disabled={!d.source || !(d.window || d.grace || d.redrafts)} onClick={() => void post(key, { action: "add_rule", carrier_id: open.carrierId, rule_type: type, window_days: toInt(d.window ?? ""), grace_days: toInt(d.grace ?? ""), redraft_attempts: toInt(d.redrafts ?? ""), redraft_interval_days: toInt(d.interval ?? ""), source: d.source as RuleSource, notes: d.notes?.trim() || null, effective_from: d.from ?? asOf }, `${RULE_TYPE_LABELS[type].label} rule saved.`)}>Save rule</Button>
                      </div>
                      </>)}
                    </section>
                  );
                })}

                <section className="grid gap-2 border-t border-border pt-4">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Commission and files</h3>
                  {(() => {
                    const key = `${open.carrierId}:settings`;
                    const d = draft(key);
                    const s = open.settings;
                    const value = (field: keyof typeof s, fallback: string) => d[field] ?? (s[field].value === null ? fallback : String(s[field].value));
                    return (
                      <>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="grid gap-1">
                            <Label htmlFor={`${key}-t`}>Commission triggers</Label>
                            <select id={`${key}-t`} className={select} value={value("commissionTrigger", "")} onChange={(e) => setDraft(key, "commissionTrigger", e.target.value)}>
                              <option value="">Not set</option>
                              {COMMISSION_TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{TRIGGER_LABEL[trigger]}</option>)}
                            </select>
                          </div>
                          <div className="grid gap-1"><Label htmlFor={`${key}-l`}>Payment lag (days)</Label><Input id={`${key}-l`} className="h-9" inputMode="numeric" value={value("expectedLagDays", "")} onChange={(e) => setDraft(key, "expectedLagDays", e.target.value.replace(/\D/g, ""))} /></div>
                          <div className="grid gap-1">
                            <Label htmlFor={`${key}-c`}>Files arrive</Label>
                            <select id={`${key}-c`} className={select} value={value("expectedCadence", "")} onChange={(e) => setDraft(key, "expectedCadence", e.target.value)}>
                              <option value="">Not set</option>
                              {CADENCES.map((cadence) => <option key={cadence} value={cadence}>{CADENCE_LABEL[cadence]}</option>)}
                            </select>
                          </div>
                          <div className="grid gap-1"><Label htmlFor={`${key}-m`}>Minimum payout ($)</Label><Input id={`${key}-m`} className="h-9" inputMode="decimal" value={d.minimumPayoutCents ?? dollars(s.minimumPayoutCents.value)} onChange={(e) => setDraft(key, "minimumPayoutCents", e.target.value.replace(/[^\d.]/g, ""))} /></div>
                          <div className="grid gap-1"><Label htmlFor={`${key}-o`}>Tolerance ($)</Label><Input id={`${key}-o`} className="h-9" inputMode="decimal" value={d.toleranceCents ?? dollars(s.toleranceCents.value)} onChange={(e) => setDraft(key, "toleranceCents", e.target.value.replace(/[^\d.]/g, ""))} /></div>
                          <div className="grid gap-1">
                            <Label htmlFor={`${key}-p`}>Statement format</Label>
                            <select id={`${key}-p`} className={select} value={value("statementFormat", "")} onChange={(e) => setDraft(key, "statementFormat", e.target.value)}>
                              <option value="">Not set</option>
                              {STATEMENT_FORMATS.map((format) => <option key={format} value={format}>{FORMAT_LABEL[format]}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <Button type="button" size="sm" onClick={() => void post(key, {
                            action: "save_settings",
                            carrier_id: open.carrierId,
                            commission_trigger: value("commissionTrigger", "") || null,
                            expected_lag_days: toInt(value("expectedLagDays", "")),
                            minimum_payout_cents: toCents(d.minimumPayoutCents ?? dollars(s.minimumPayoutCents.value)),
                            tolerance_cents: toCents(d.toleranceCents ?? dollars(s.toleranceCents.value)),
                            expected_cadence: value("expectedCadence", "") || null,
                            statement_format: value("statementFormat", "") || null,
                          }, "Settings saved.")}>Save settings</Button>
                        </div>
                      </>
                    );
                  })()}
                </section>

                <section className="grid gap-1 border-t border-border pt-4 text-sm">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Kept with the carrier elsewhere</h3>
                  <p className="m-0">Commissions address: {open.elsewhere.commissionsAddress ? "saved (from a dispute letter)" : plane === "agency" ? "not saved yet — save it on a dispute letter" : "set by each agency"}</p>
                  <p className="m-0">Layout map: {open.elsewhere.layoutKey ? <span className="font-mono text-xs">{open.elsewhere.layoutKey}</span> : "none assigned"}</p>
                  <p className="m-0">Portal: {open.elsewhere.portalOrigin ?? "not set"} · Reference pattern: {open.elsewhere.referencePattern ? <span className="font-mono text-xs">{open.elsewhere.referencePattern}</span> : "not set"}</p>
                </section>
              </fieldset>

              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setOpenId(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export type { RuleType };
