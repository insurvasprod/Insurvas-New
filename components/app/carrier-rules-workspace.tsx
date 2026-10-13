"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarCheckbox, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
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
  const [page, setPage] = useState(1);

  const visible = useMemo(() => carriers.filter((row) => (!query.trim() || row.carrierName.toLowerCase().includes(query.trim().toLowerCase())) && (!gapsOnly || row.gaps.length > 0)), [carriers, query, gapsOnly]);
  const shown = paginate(visible, page, 25);
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
            {(query.trim() || gapsOnly) && <ClearFiltersButton onClick={() => { setQuery(""); setGapsOnly(false); setPage(1); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search carriers" />
            <ToolbarCheckbox checked={gapsOnly} onChange={(value) => { setGapsOnly(value); setPage(1); }} label="Only carriers with a missing rule" />
          </DataToolbar>
        }
        footer={visible.length > 25 ? <Pager page={shown.current} pageSize={25} total={visible.length} noun="carriers" onPage={setPage} /> : undefined}
      >
        {carriers.length === 0 ? (
          <EmptyState title="No carriers in the library" hint="Carriers come from the platform's carrier library." />
        ) : visible.length === 0 ? (
          <NoMatches noun="carriers" onClear={() => { setQuery(""); setGapsOnly(false); setPage(1); }} />
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
              {shown.rows.map((row) => (
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
              {/* LA-4.17: each missing rule, with the policies it leaves without a countdown. */}
              {open.gaps.length > 0 && (
                <ul role="status" className="m-0 grid list-none gap-1 rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
                  {open.gaps.map((gap) => <li key={gap.sentence}>{gap.sentence}</li>)}
                </ul>
              )}


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

                <section className="grid gap-2 border-t border-border pt-4 text-sm">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Commissions department</h3>
                  {plane === "agency"
                    ? <CommissionsContactForm key={open.carrierId} carrierId={open.carrierId} carrierName={open.carrierName} saved={open.commissionsContact} onSaved={() => router.refresh()} />
                    : <p className="m-0 text-muted-foreground">Set by each agency, for its dispute letters.</p>}
                </section>

                <section className="grid gap-1 border-t border-border pt-4 text-sm">
                  <h3 className="m-0 text-sm font-semibold text-foreground">Finding its files</h3>
                  {open.guidance ? (
                    <dl className="m-0 grid gap-1 sm:grid-cols-[140px_1fr]">
                      {open.guidance.whereInPortal && <><dt className="text-muted-foreground">In the portal</dt><dd className="m-0 whitespace-pre-line">{open.guidance.whereInPortal}</dd></>}
                      {open.guidance.reportName && <><dt className="text-muted-foreground">Report</dt><dd className="m-0">{open.guidance.reportName}</dd></>}
                      {open.guidance.formatHint && <><dt className="text-muted-foreground">Format</dt><dd className="m-0">{open.guidance.formatHint}</dd></>}
                      {open.guidance.notes && <><dt className="text-muted-foreground">Notes</dt><dd className="m-0 whitespace-pre-line">{open.guidance.notes}</dd></>}
                    </dl>
                  ) : <p className="m-0 text-muted-foreground">No portal guidance written for this carrier yet.</p>}
                  <p className="m-0">Layout map: {open.elsewhere.layoutKey ? <span className="font-mono text-xs">{open.elsewhere.layoutKey}</span> : "none assigned"}</p>
                  <p className="m-0">
                    Portal: {open.elsewhere.portalOrigin ?? "not set"} · Policy number pattern: {open.elsewhere.referencePattern ? <span className="font-mono text-xs">{open.elsewhere.referencePattern}</span> : "not set"}
                    {plane === "agency" && <> · <Link href="/app/settings#sales-carriers" className="font-semibold underline">Change</Link></>}
                  </p>
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

/**
 * The agency's commissions department for this carrier: where its dispute letters go (LA-4.15),
 * kept with the carrier's other facts (LA-4.17). The same record the dispute letter saves.
 */
function CommissionsContactForm({ carrierId, carrierName, saved, onSaved }: { carrierId: string; carrierName: string; saved: { address: string; email: string | null } | null; onSaved: () => void }) {
  const [address, setAddress] = useState(saved?.address ?? "");
  const [email, setEmail] = useState(saved?.email ?? "");
  const [saving, setSaving] = useState(false);
  const changed = address.trim() !== (saved?.address ?? "").trim() || email.trim() !== (saved?.email ?? "").trim();
  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/app/discrepancies/carrier-contact", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: carrierId, address, email: email.trim() || null }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The address was not saved.");
      notify.done(`Saved: ${carrierName}'s dispute letters go to this address.`);
      onSaved();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The address was not saved.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
      <div className="grid gap-1">
        <Label htmlFor={`${carrierId}-addr`}>Address for dispute letters</Label>
        <textarea id={`${carrierId}-addr`} rows={3} maxLength={600} value={address} placeholder={`${carrierName}
Commissions Department`} onChange={(e) => setAddress(e.target.value)} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" />
      </div>
      <div className="grid content-start gap-1">
        <Label htmlFor={`${carrierId}-mail`}>Email (optional)</Label>
        <Input id={`${carrierId}-mail`} type="email" className="h-9" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="button" size="sm" className="mt-2 w-fit" disabled={saving || !changed || !address.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save address"}</Button>
      </div>
    </div>
  );
}

export type { RuleType };
