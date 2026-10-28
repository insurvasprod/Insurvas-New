"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { METHOD_LABELS, VERIFICATION_METHODS } from "@/lib/compliance/dataSubject";
import { TILE_KEYS, TILE_LABELS } from "@/lib/compliance/dashboardCore";
import { GAP_CATEGORIES } from "@/lib/compliance/evidenceGaps";
import {
  ACTION_LABELS,
  BASES,
  BASIS_LABELS,
  HOLD_REASON_LABELS,
  HOLD_SCOPE_LABELS,
  NOT_LEGAL_ADVICE,
  RECORD_TYPES,
  describeDays,
  type HoldReason,
  type HoldScope,
  type RetentionAction,
  type RetentionBasis,
  type RuleRow,
} from "@/lib/compliance/retention";
import type { ComplianceSettings } from "@/lib/compliance/settingsStore";
import type { Hold, Run } from "@/lib/compliance/retentionStore";
import { notify } from "@/lib/notify";
import { fieldLabel } from "@/components/ui/field";

/**
 * LA-6.8 · compliance settings, one section at a time. Every save goes to /api/app/compliance/settings,
 * which validates it, enforces the platform caps and writes an audit row. Coverage over silence: each
 * section that has unset values says how many, and what that means.
 */
const SECTIONS = ["deadlines", "retention", "purge", "holds", "deletion", "gate", "report", "dashboard", "log"] as const;
type Section = (typeof SECTIONS)[number];
type Bundle = {
  settings: ComplianceSettings;
  caps: { deletionHoldFloorDays: number; lockedGateChecks: string[]; neverDelete: string[] };
  deadlines: { available: boolean; rows: { regulator: string; responseDays: number; notes: string | null }[]; coverage: { licensed: number; covered: number; missing: string[]; ftc: boolean; sentence: string } };
  rules: RuleRow[];
  holds: Hold[];
  runs: Run[];
  changes: { section: string; setting: string; from: unknown; to: unknown; by: string | null; at: string }[];
  team: { id: string; role: string; name: string }[];
};

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const field = fieldLabel;
const area = "min-h-16 rounded-md border border-input bg-background px-3 py-2 text-sm";
const alertWarn = "rounded-lg border border-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]";

function Toggle({ label, checked, onChange, disabled, locked }: { label: ReactNode; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; locked?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled || Boolean(locked)} onChange={(e) => onChange?.(e.target.checked)} />
      <span>{label}</span>
      {locked ? <StatusChip tone="neutral">{locked}</StatusChip> : null}
    </label>
  );
}

export function ComplianceSettingsBoard({ readOnly }: { readOnly: boolean }) {
  const [tab, setTab] = useState<Section>("deadlines");
  // Settings search (LA-8.1) lands here as /app/compliance/settings#gate: the hash names the tab.
  useEffect(() => {
    const fromHash = () => {
      const key = window.location.hash.slice(1);
      if ((SECTIONS as readonly string[]).includes(key)) setTab(key as Section);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    fetch("/api/app/compliance/settings").then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Settings could not be loaded");
      else setData(body);
    });
    return () => { live = false; };
  }, [reloads]);

  const post = async (url: string, payload: unknown, done: string, method = "POST") => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't save");
      if (url === "/api/app/compliance/settings") setData(body);
      else load();
      notify.done(done);
      return true;
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: Record<string, unknown>, done = "Saved") => post("/api/app/compliance/settings", { op: "settings", patch }, done);

  if (error) return <ErrorState detail={error} action={<Button variant="outline" onClick={() => { setError(null); load(); }}>Try again</Button>} />;
  if (!data) return <TableCard><SectionLoading rows={6} columns={3} /></TableCard>;
  const s = data.settings;
  const disabled = readOnly || busy;
  const tabs = [
    { key: "deadlines" as const, label: "Complaint deadlines", count: data.deadlines.coverage.missing.length || null, tone: "danger" as const },
    { key: "retention" as const, label: "Retention rules" },
    { key: "purge" as const, label: "Purge job" },
    { key: "holds" as const, label: "Legal holds", count: data.holds.filter((h) => !h.releasedAt).length },
    { key: "deletion" as const, label: "Deletion requests" },
    { key: "gate" as const, label: "Transfer gate" },
    { key: "report" as const, label: "Evidence report" },
    { key: "dashboard" as const, label: "Dashboard" },
    { key: "log" as const, label: "Change log" },
  ];

  return (
    <div id={tab} className="flex scroll-mt-24 flex-col gap-4">
      <ViewTabs label="Compliance settings" tabs={tabs} value={tab} onChange={setTab} />
      {tab === "deadlines" ? <Deadlines data={data} disabled={disabled} save={save} post={post} /> : null}
      {tab === "retention" ? <Retention data={data} disabled={disabled} post={post} /> : null}
      {tab === "purge" ? <Purge data={data} disabled={disabled} save={save} post={post} /> : null}
      {tab === "holds" ? <Holds data={data} disabled={disabled} post={post} /> : null}
      {tab === "deletion" ? (
        <TableCard title="Deletion requests" description="How a consumer's deletion request is checked and when it may run.">
          <div className="flex flex-col gap-4 px-4 pb-4">
            <label className={field}>Hold after verification, in days (platform floor {data.caps.deletionHoldFloorDays})
              <input type="number" min={data.caps.deletionHoldFloorDays} max={45} className={`${toolbarControl} w-28`} defaultValue={s.deletion.holdDays} disabled={disabled} onBlur={(e) => { const v = Number(e.target.value); if (v !== s.deletion.holdDays) void save({ "deletion.holdDays": v }); }} />
            </label>
            <div className="flex flex-col gap-1"><span className="text-sm font-semibold">Accepted ways to verify identity</span>
              {VERIFICATION_METHODS.map((m) => <Toggle key={m} label={METHOD_LABELS[m]} checked={s.deletion.methods.includes(m)} disabled={disabled} onChange={(on) => void save({ "deletion.methods": on ? [...s.deletion.methods, m] : s.deletion.methods.filter((x) => x !== m) })} />)}
            </div>
            <div className="flex flex-col gap-1"><span className="text-sm font-semibold">Who may verify and perform a deletion</span>
              <Toggle label="Owner (tenant admin)" checked locked="Always" />
              <Toggle label="Producers" checked={s.deletion.performerRoles.includes("producer")} disabled={disabled} onChange={(on) => void save({ "deletion.performerRoles": on ? ["owner", "producer"] : ["owner"] })} />
            </div>
          </div>
        </TableCard>
      ) : null}
      {tab === "gate" ? (
        <TableCard title="Transfer gate" description="The checks run before a partner's transfer is accepted.">
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-1">
              <Toggle label="TCPA litigator" checked locked="Always on" />
              <Toggle label="Internal do-not-call list" checked locked="Always on" />
              <Toggle label="Federal and state do-not-call" checked={s.gate.federalDnc} disabled={disabled} onChange={(v) => void save({ "gate.federalDnc": v })} />
              <Toggle label="Consent artefact present" checked={s.gate.consent} disabled={disabled} onChange={(v) => void save({ "gate.consent": v })} />
              <Toggle label="Existing customer" checked={s.gate.existingCustomer} disabled={disabled} onChange={(v) => void save({ "gate.existingCustomer": v })} />
              <Toggle label="Inside legal calling hours" checked={s.gate.callingHours} disabled={disabled} onChange={(v) => void save({ "gate.callingHours": v })} />
            </div>
            <label className={field}>When no consent artefact is on file
              <select className={`${toolbarControl} w-60`} value={s.gate.consentMissing} disabled={disabled} onChange={(e) => void save({ "gate.consentMissing": e.target.value })}>
                <option value="warn">Warn (accept, prominently flagged)</option>
                <option value="block">Block the transfer</option>
              </select>
            </label>
            <label className={field}>Time budget per check (ms)
              <input type="number" min={500} max={10000} step={100} className={`${toolbarControl} w-32`} defaultValue={s.gate.timeoutMs} disabled={disabled} onBlur={(e) => { const v = Number(e.target.value); if (v !== s.gate.timeoutMs) void save({ "gate.timeoutMs": v }); }} />
            </label>
            <p className="text-sm text-muted-foreground">Calling windows are edited in <Link className="underline" href="/app/settings#calling-windows">Settings › Calling windows</Link>; screening vendors are chosen by the platform.</p>
          </div>
        </TableCard>
      ) : null}
      {tab === "report" ? (
        <TableCard title="Evidence report" description="Which gap checks run, and who may generate a report.">
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-1"><span className="text-sm font-semibold">Gap checks</span>
              {GAP_CATEGORIES.map((g) => <Toggle key={g.key} label={g.label} checked={s.report.gapChecks.includes(g.key)} disabled={disabled} onChange={(on) => void save({ "report.gapChecks": on ? [...s.report.gapChecks, g.key] : s.report.gapChecks.filter((x) => x !== g.key) })} />)}
              <span className="text-xs text-muted-foreground">A check switched off is shown as switched off on every report — never as passed.</span>
            </div>
            <div className="flex flex-col gap-1"><span className="text-sm font-semibold">Who may generate reports</span>
              <Toggle label="Owner" checked locked="Always" />
              <Toggle label="Producers" checked={s.report.roles.includes("producer")} disabled={disabled} onChange={(on) => void save({ "report.roles": on ? ["owner", "producer"] : ["owner"] })} />
            </div>
            <p className="text-sm text-muted-foreground">No report copies are stored, so there is nothing to keep; the report-retention rule is under Retention rules. Disclosures are edited in <Link className="underline" href="/app/settings#sales-disclosures">Settings › Disclosures</Link>.</p>
          </div>
        </TableCard>
      ) : null}
      {tab === "dashboard" ? (
        <TableCard title="Dashboard" description="What the compliance dashboard shows, and the monthly email.">
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-1"><span className="text-sm font-semibold">Tiles</span>
              {TILE_KEYS.map((k) => <Toggle key={k} label={TILE_LABELS[k]} checked={!s.dashboard.hiddenTiles.includes(k)} disabled={disabled} onChange={(on) => void save({ "dashboard.hiddenTiles": on ? s.dashboard.hiddenTiles.filter((x) => x !== k) : [...s.dashboard.hiddenTiles, k] })} />)}
            </div>
            <Toggle label="Email the coverage figures and the book-wide gap scan once a month" checked={s.dashboard.monthlyEmail} disabled={disabled} onChange={(v) => void save({ "dashboard.monthlyEmail": v })} />
            <Recipients team={data.team} value={s.dashboard.recipients} disabled={disabled} onChange={(ids) => void save({ "dashboard.recipients": ids })} empty="The agency owners" />
          </div>
        </TableCard>
      ) : null}
      {tab === "log" ? (
        <TableCard title="Change log" description="Every change: who, what, from, to, when.">
          {data.changes.length === 0 ? <EmptyState title="No changes yet" hint="Every change made here is listed, with what it was before." /> : (
            <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
              <thead><tr><th className="w-[160px]">When</th><th className="w-[170px]">Section</th><th>Setting</th><th>From → to</th><th className="w-[160px]">By</th></tr></thead>
              <tbody>
                {data.changes.map((c) => (
                  <tr key={`${c.at}-${c.setting}`}>
                    <td>{c.at.slice(0, 16).replace("T", " ")}</td>
                    <td>{c.section.replace(/_/g, " ")}</td>
                    <td className="font-mono text-xs">{c.setting}</td>
                    <td className="break-all text-xs">{JSON.stringify(c.from)} → {JSON.stringify(c.to)}</td>
                    <td>{data.team.find((t) => t.id === c.by)?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}
    </div>
  );
}

type Post = (url: string, payload: unknown, done: string, method?: string) => Promise<boolean>;
type Save = (patch: Record<string, unknown>, done?: string) => Promise<boolean>;

function Recipients({ team, value, disabled, onChange, empty }: { team: Bundle["team"]; value: string[]; disabled: boolean; onChange: (ids: string[]) => void; empty: string }) {
  const owners = team.filter((t) => t.role === "owner" || t.role === "producer");
  return (
    <div className="flex flex-col gap-1"><span className="text-sm font-semibold">Recipients{value.length ? "" : ` (none chosen: ${empty})`}</span>
      {owners.map((p) => <Toggle key={p.id} label={`${p.name} (${p.role})`} checked={value.includes(p.id)} disabled={disabled} onChange={(on) => onChange(on ? [...value, p.id] : value.filter((x) => x !== p.id))} />)}
    </div>
  );
}

function Deadlines({ data, disabled, save, post }: { data: Bundle; disabled: boolean; save: Save; post: Post }) {
  const [regulator, setRegulator] = useState("");
  const [days, setDays] = useState("");
  const [notes, setNotes] = useState("");
  const c = data.deadlines.coverage;
  return (
    <>
      {c.missing.length || !c.licensed ? <p role="alert" className={alertWarn}>{c.sentence}{c.missing.length ? ` Missing: ${c.missing.join(", ")}.` : ""}</p> : null}
      {!c.ftc ? <p className={alertWarn}>No FTC response days set: an FTC complaint would have no countdown.</p> : null}
      <TableCard title="Response days by regulator" description="Statutory days to answer a state insurance department (DOI) or the FTC. Unset means no countdown — never a guessed default."
        toolbar={!disabled ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/app/compliance/settings", { op: "deadline", regulator, response_days: Number(days), notes: notes || null }, `Deadline set for ${regulator}`)) { setRegulator(""); setDays(""); setNotes(""); } }}>
            <label className={field}>Regulator<select className={toolbarControl} value={regulator} onChange={(e) => setRegulator(e.target.value)} required><option value="">Choose…</option><option value="FTC">FTC</option>{STATES.map((st) => <option key={st} value={st}>{st} DOI{c.missing.includes(st) ? " (licensed, unset)" : ""}</option>)}</select></label>
            <label className={field}>Days<input type="number" min={1} max={180} className={`${toolbarControl} w-24`} value={days} onChange={(e) => setDays(e.target.value)} required /></label>
            <label className={field}>Source<input className={`${toolbarControl} w-64`} placeholder="e.g. the statute section" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            <Button type="submit">Save</Button>
          </form>
        ) : undefined}
      >
        {data.deadlines.rows.length === 0 ? <EmptyState title="No deadlines set" hint="Look up each licensed state's DOI response days and add them." /> : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th className="w-[160px]">Regulator</th><th className="w-[120px]">Days</th><th>Source</th><th className="w-[110px] text-right" /></tr></thead>
            <tbody>{data.deadlines.rows.map((r) => (
              <tr key={r.regulator}><td>{r.regulator === "FTC" ? "FTC" : `${r.regulator} DOI`}</td><td>{r.responseDays}</td><td>{r.notes ?? "—"}</td>
                <td className="text-right">{!disabled ? <Button size="sm" variant="outline" onClick={() => void post("/api/app/compliance/settings", { op: "deadline", regulator: r.regulator, response_days: null }, "Deadline removed")}>Remove</Button> : null}</td></tr>
            ))}</tbody>
          </table>
        )}
      </TableCard>
      <TableCard title="Escalation" description="When a regulator complaint turns amber and red. Inside red it pins to the dashboard and the daily email starts.">
        <div className="flex flex-wrap gap-4 px-4 pb-4">
          <label className={field}>Amber at (days left)<input type="number" min={1} max={90} className={`${toolbarControl} w-24`} defaultValue={data.settings.complaints.amberDays} disabled={disabled} onBlur={(e) => { const v = Number(e.target.value); if (v !== data.settings.complaints.amberDays) void save({ "complaints.amberDays": v }); }} /></label>
          <label className={field}>Red at (days left)<input type="number" min={1} max={60} className={`${toolbarControl} w-24`} defaultValue={data.settings.complaints.redDays} disabled={disabled} onBlur={(e) => { const v = Number(e.target.value); if (v !== data.settings.complaints.redDays) void save({ "complaints.redDays": v }); }} /></label>
        </div>
      </TableCard>
    </>
  );
}

function Retention({ data, disabled, post }: { data: Bundle; disabled: boolean; post: Post }) {
  const [edit, setEdit] = useState<{ recordType: string; state: string; days: string; action: RetentionAction; basis: RetentionBasis; notes: string } | null>(null);
  const platform = (t: string) => data.rules.find((r) => r.tenantId === null && r.recordType === t && r.state === null) ?? null;
  const mine = (t: string) => data.rules.filter((r) => r.tenantId !== null && r.recordType === t);
  return (
    <>
      <p role="note" className={alertWarn}>{NOT_LEGAL_ADVICE}</p>
      <TableCard title="Retention rules" description="Per record type, per state. Your rule for a state beats your all-states rule, which beats the platform's. A type with no rule is never purged.">
        <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr><th className="w-[230px]">Record type</th><th>Platform default (read-only)</th><th>Your rules</th><th className="w-[200px] text-right" /></tr></thead>
          <tbody>{RECORD_TYPES.map((t) => {
            const p = platform(t.key);
            const locked = data.caps.neverDelete.includes(t.key);
            return (
              <tr key={t.key}>
                <td className="font-medium">{t.label}</td>
                <td>{p ? <><div>{describeDays(p.retainDays)} · {ACTION_LABELS[p.action as RetentionAction] ?? p.action}</div><div className="text-xs text-muted-foreground">Basis: {BASIS_LABELS[p.basis as RetentionBasis] ?? p.basis}</div></> : <StatusChip tone="warning">No rule: never purged</StatusChip>}</td>
                <td>{locked ? <StatusChip tone="neutral">Locked: never deleted</StatusChip> : mine(t.key).length === 0 ? <span className="text-muted-foreground">Uses the platform default</span> : mine(t.key).map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2">
                    <span>{r.state ?? "All states"}: {describeDays(r.retainDays)} · {ACTION_LABELS[r.action as RetentionAction] ?? r.action} · basis {BASIS_LABELS[r.basis as RetentionBasis] ?? r.basis}</span>
                    {!disabled ? <Button size="sm" variant="outline" onClick={() => void post("/api/app/compliance/settings", { op: "delete_rule", id: r.id }, "Rule removed")}>Remove</Button> : null}
                  </div>
                ))}</td>
                <td className="text-right">{!locked && !disabled ? (
                  <div className="flex justify-end gap-2">
                    {p && mine(t.key).length === 0 ? <Button size="sm" variant="outline" onClick={() => void post("/api/app/compliance/settings", { op: "copy_rule", record_type: t.key }, "Copied to your agency")}>Copy to my tenant</Button> : null}
                    <Button size="sm" variant="outline" onClick={() => setEdit({ recordType: t.key, state: "", days: String(p?.retainDays ?? 1461), action: (p?.action as RetentionAction) === "anonymise" ? "anonymise" : "purge", basis: "our_policy", notes: "" })}>Add a rule</Button>
                  </div>
                ) : null}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </TableCard>
      {edit ? (
        <Dialog open onOpenChange={(o) => { if (!o) setEdit(null); }}>
          <DialogContent className="sm:max-w-[520px]">
            <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/app/compliance/settings", { op: "rule", record_type: edit.recordType, state: edit.state || null, retain_days: Number(edit.days), action: edit.action, basis: edit.basis, notes: edit.notes || null }, "Rule saved")) setEdit(null); }}>
              <DialogHeader><DialogTitle>{RECORD_TYPES.find((r) => r.key === edit.recordType)?.label}</DialogTitle><DialogDescription>{NOT_LEGAL_ADVICE}</DialogDescription></DialogHeader>
              <label className={field}>State<select className={toolbarControl} value={edit.state} onChange={(e) => setEdit({ ...edit, state: e.target.value })}><option value="">All states</option>{STATES.map((st) => <option key={st} value={st}>{st}</option>)}</select></label>
              <label className={field}>Keep for (days)<input type="number" min={30} max={7300} className={toolbarControl} value={edit.days} onChange={(e) => setEdit({ ...edit, days: e.target.value })} required /></label>
              <label className={field}>Then<select className={toolbarControl} value={edit.action} onChange={(e) => setEdit({ ...edit, action: e.target.value as RetentionAction })}><option value="purge">Delete</option><option value="anonymise">Anonymise, keep</option></select></label>
              <label className={field}>Where the number comes from<select className={toolbarControl} value={edit.basis} onChange={(e) => setEdit({ ...edit, basis: e.target.value as RetentionBasis })}>{BASES.map((b) => <option key={b} value={b}>{BASIS_LABELS[b]}</option>)}</select></label>
              <label className={field}>Notes<textarea className={area} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="e.g. counsel's advice of 3 March" /></label>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit">Save rule</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
      <p className="text-sm text-muted-foreground">Insurvas keeps each carrier&apos;s retention windows.</p>
    </>
  );
}

function Purge({ data, disabled, save, post }: { data: Bundle; disabled: boolean; save: Save; post: Post }) {
  const [confirm, setConfirm] = useState(false);
  const [now] = useState(() => Date.now());
  const p = data.settings.purge;
  const lastDry = data.runs.find((r) => r.mode === "dry_run" && r.finishedAt);
  const dryFresh = lastDry && now - Date.parse(lastDry.finishedAt!) < p.windowDays * 86_400_000;
  return (
    <>
      {!p.scheduleEnabled ? <p role="alert" className={alertWarn}>The retention schedule is off: nothing is purged unless you run it. A retention policy nobody enforces is a document, not a control.</p> : null}
      <TableCard title="Purge job" description="A dry run first, every time. A live run needs a dry run inside the window."
        action={!disabled ? <><Button variant="outline" onClick={() => void post("/api/app/compliance/retention/runs", { mode: "dry_run" }, "Dry run done")}>Dry run now</Button><Button disabled={!dryFresh} onClick={() => setConfirm(true)}>Live run</Button></> : undefined}>
        <div className="flex flex-wrap gap-4 px-4 pb-4">
          <Toggle label="Run on a schedule (dry run, emailed, then live after the window)" checked={p.scheduleEnabled} disabled={disabled} onChange={(v) => void save({ "purge.scheduleEnabled": v })} />
          <label className={field}>Dry-run-to-live window (days)<input type="number" min={1} max={30} className={`${toolbarControl} w-24`} defaultValue={p.windowDays} disabled={disabled} onBlur={(e) => { const v = Number(e.target.value); if (v !== p.windowDays) void save({ "purge.windowDays": v }); }} /></label>
          <Recipients team={data.team} value={p.recipients} disabled={disabled} onChange={(ids) => void save({ "purge.recipients": ids })} empty="The agency owners" />
        </div>
      </TableCard>
      <TableCard title="Runs" description="Matched, held and purged, per record type.">
        {data.runs.length === 0 ? <EmptyState title="No runs yet" hint="Start with a dry run: it deletes nothing and shows what a live run would." /> : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th className="w-[160px]">When</th><th className="w-[110px]">Mode</th><th>Per record type (matched / held / purged)</th><th className="w-[120px]">Unruled</th></tr></thead>
            <tbody>{data.runs.map((r) => (
              <tr key={r.id}>
                <td>{r.startedAt.slice(0, 16).replace("T", " ")}</td>
                <td><StatusChip tone={r.mode === "live" ? "danger" : "info"}>{r.mode === "live" ? "Live" : "Dry run"}</StatusChip></td>
                <td className="text-xs">{r.results.filter((x) => x.rows_matched || x.note).map((x) => `${RECORD_TYPES.find((t) => t.key === x.record_type)?.label ?? x.record_type}: ${x.rows_matched} / ${x.rows_held} / ${x.rows_purged}${x.oldest ? ` (oldest ${String(x.oldest).slice(0, 10)})` : ""}`).join(" · ") || "Nothing due"}</td>
                <td className="text-xs">{r.unruled.length ? r.unruled.join(", ") : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </TableCard>
      {confirm ? (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirm(false); }}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader><DialogTitle>Run the purge for real?</DialogTitle><DialogDescription>It deletes what the last dry run listed (and anything that came due since). Held records and the do-not-call list are never touched.</DialogDescription></DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={disabled} onClick={async () => { await post("/api/app/compliance/retention/runs", { mode: "live", confirm: true }, "Live run done"); setConfirm(false); }}>Run it</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function Holds({ data, disabled, post }: { data: Bundle; disabled: boolean; post: Post }) {
  const [form, setForm] = useState<{ scope: HoldScope; value: string; reason: HoldReason; note: string }>({ scope: "phone_digits", value: "", reason: "litigation", note: "" });
  const [releasing, setReleasing] = useState<Hold | null>(null);
  const [why, setWhy] = useState("");
  const active = data.holds.filter((h) => !h.releasedAt);
  return (
    <>
      <TableCard title="Legal holds" description="Nothing under a hold is purged — by retention or a deletion request. Complaint and dispute holds come from their source and stay until it closes."
        toolbar={!disabled ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/app/compliance/retention/holds", { scope: form.scope, value: form.scope === "tenant_wide" ? null : form.value, reason: form.reason, note: form.note }, "Hold placed")) setForm({ ...form, value: "", note: "" }); }}>
            <label className={field}>Covers<select className={toolbarControl} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as HoldScope })}>{(["phone_digits", "policy_number", "tenant_wide"] as HoldScope[]).map((sc) => <option key={sc} value={sc}>{HOLD_SCOPE_LABELS[sc]}</option>)}</select></label>
            {form.scope !== "tenant_wide" ? <label className={field}>{form.scope === "phone_digits" ? "Number" : "Policy number"}<input className={`${toolbarControl} w-48`} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required /></label> : null}
            <label className={field}>Why<select className={toolbarControl} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as HoldReason })}>{(["litigation", "regulator_inquiry", "manual"] as HoldReason[]).map((r) => <option key={r} value={r}>{HOLD_REASON_LABELS[r]}</option>)}</select></label>
            <label className={field}>Note<input className={`${toolbarControl} w-64`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} required /></label>
            <Button type="submit">Place hold</Button>
          </form>
        ) : undefined}
      >
        {active.length === 0 ? <EmptyState title="No active holds" hint="A complaint or a commission dispute places one automatically; place one by hand for litigation." /> : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th>Covers</th><th className="w-[180px]">Why</th><th className="w-[140px]">Placed</th><th>Note</th><th className="w-[120px] text-right" /></tr></thead>
            <tbody>{active.map((h) => (
              <tr key={h.id}>
                <td>{HOLD_SCOPE_LABELS[h.scope]}{h.scopeValue ? `: ${h.scopeValue}` : ""}</td>
                <td>{HOLD_REASON_LABELS[h.reason]}{h.automatic ? <div className="text-xs text-muted-foreground">from its {h.reason === "complaint" ? "complaint" : "dispute"}</div> : null}</td>
                <td>{h.placedAt.slice(0, 10)}</td>
                <td>{h.note ?? "—"}</td>
                <td className="text-right">{!disabled ? <Button size="sm" variant="outline" onClick={() => { setReleasing(h); setWhy(""); }}>Release</Button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </TableCard>
      {releasing ? (
        <Dialog open onOpenChange={(o) => { if (!o) setReleasing(null); }}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader><DialogTitle>Release this hold?</DialogTitle><DialogDescription>{releasing.automatic ? "An automatic hold is released only once its complaint or dispute is closed." : "From now on the records it covered can be purged on schedule."}</DialogDescription></DialogHeader>
            <textarea className={area} placeholder="Why it is released" value={why} onChange={(e) => setWhy(e.target.value)} />
            <DialogFooter><Button variant="outline" onClick={() => setReleasing(null)}>Keep it</Button><Button disabled={!why.trim()} onClick={async () => { if (await post("/api/app/compliance/retention/holds", { id: releasing.id, note: why }, "Hold released", "PATCH")) setReleasing(null); }}>Release</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
