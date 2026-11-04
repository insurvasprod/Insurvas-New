"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Recipients, SETTINGS_URL, regulatorName, useComplianceBundle } from "@/components/app/compliance/compliance-settings-data";
import { Advanced, FormSection, FormSections } from "@/components/app/settings/patterns";
import { DraftActions, SettingsTableCard, st } from "@/components/app/settings/primitives";
import { LockedNote, SectionTabs, SettingRow, useAnchorTab } from "@/components/app/settings/setting-row";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { checkboxControl, inputControl, Switch } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { METHOD_LABELS, VERIFICATION_METHODS } from "@/lib/compliance/dataSubject";
import { TILE_KEYS, TILE_LABELS } from "@/lib/compliance/dashboardCore";
import { GAP_CATEGORIES } from "@/lib/compliance/evidenceGaps";
import { ACTION_LABELS, BASIS_LABELS, HOLD_REASON_LABELS, HOLD_SCOPE_LABELS, NOT_LEGAL_ADVICE, RECORD_TYPES, describeDays, type RetentionAction, type RetentionBasis } from "@/lib/compliance/retention";
import type { ComplianceSettings } from "@/lib/compliance/settingsStore";
import { cn } from "@/lib/utils";

/**
 * LA-6.8 · compliance settings. Every save goes to /api/app/compliance/settings, which validates it,
 * enforces the platform caps and writes an audit row (the header's History reads them). Coverage
 * over silence: a section with unset values says how many, and what that means.
 *
 * Money & compliance redesign A (owner pick 2026-11-03, docs/settings/MONEY-COMPLIANCE-SETTINGS.md):
 * tabs on the title line, Start here first with the three decisions an owner has to make, one save
 * bar for the settings (fields used to save when they lost focus), and the lists open pages:
 * a deadline, a record type's rules, a hold, a run. No notice boxes: an unset licensed state is a row
 * of the deadlines list with an amber chip.
 */
type Tab = "start" | "complaints" | "records" | "holds" | "transfers";
/** Every anchor Settings search links to (#purge), and the tab that holds it. */
export const SECTION_TAB = {
  deadlines: "complaints",
  retention: "records",
  purge: "records",
  holds: "holds",
  deletion: "holds",
  gate: "transfers",
  report: "transfers",
  dashboard: "transfers",
} as const satisfies Record<string, Tab>;

type Flat = Record<string, unknown>;
const flatten = (s: ComplianceSettings): Flat => Object.fromEntries(Object.entries(s).flatMap(([section, values]) => Object.entries(values).map(([k, v]) => [`${section}.${k}`, v])));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const toggle = (list: string[], key: string, on: boolean) => (on ? [...list, key] : list.filter((x) => x !== key));
const PAGE = 10;

/** A table row that opens a page; the first cell's link is the keyboard way in. */
function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="font-medium text-[var(--ink)] no-underline hover:text-[var(--accent-ink)]">{children}</Link>;
}

export function ComplianceSettingsBoard({ readOnly }: { readOnly: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("start");
  useAnchorTab(SECTION_TAB, setTab);
  const { data, error, busy, reload, write } = useComplianceBundle();
  // Only what the owner changed; every other value reads from the saved settings.
  const [edits, setEdits] = useState<Flat>({});
  const [confirmLive, setConfirmLive] = useState(false);
  const [deadlinePage, setDeadlinePage] = useState(1);
  const [holdPage, setHoldPage] = useState(1);
  const [runPage, setRunPage] = useState(1);
  const [now] = useState(() => Date.now());

  if (error) return <ErrorState detail={error} action={<Button variant="outline" onClick={reload}>Try again</Button>} />;
  if (!data) return <TableCard><SectionLoading rows={6} columns={3} /></TableCard>;

  const saved = flatten(data.settings);
  const draft: Flat = { ...saved, ...edits };
  const changed = Object.keys(edits).filter((k) => !same(edits[k], saved[k]));
  const dirty = changed.length > 0;
  const dis = readOnly || busy;
  const v = <T,>(key: string) => draft[key] as T;
  const set = (key: string, value: unknown) => setEdits((cur) => ({ ...cur, [key]: value }));
  const save = async () => { const ok = await write("/api/app/compliance/settings", { op: "settings", patch: Object.fromEntries(changed.map((k) => [k, draft[k]])) }, `Saved ${changed.length} change${changed.length === 1 ? "" : "s"}`); if (ok) setEdits({}); return ok; };
  const discard = () => setEdits({});
  const num = (key: string, label: string, opts: { min: number; max: number; unit?: string; step?: number; width?: string }) => (
    <span className="flex items-center gap-2 text-sm text-[var(--muted)]">
      <input aria-label={label} className={cn(inputControl, opts.width ?? "w-24", "tabular-nums")} disabled={dis} type="number" min={opts.min} max={opts.max} step={opts.step ?? 1} value={String(v<number>(key) ?? "")} onChange={(e) => set(key, e.target.value === "" ? null : Math.round(Number(e.target.value)))} />
      {opts.unit}
    </span>
  );
  const onOff = (key: string, label: string, onText = "On", offText = "Off") => (
    <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label={label} checked={Boolean(v<boolean>(key))} disabled={dis} onChange={(on) => set(key, on)} />{v<boolean>(key) ? onText : offText}</span>
  );
  const locked = (label: string, why: string) => <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label={label} checked disabled />{label}<StatusChip tone="neutral">{why}</StatusChip></span>;

  const c = data.deadlines.coverage;
  const unset = [...c.missing, ...(c.ftc ? [] : ["FTC"])];
  const deadlineRows = [
    ...unset.map((regulator) => ({ regulator, responseDays: null as number | null, notes: null as string | null })),
    ...data.deadlines.rows.map((r) => ({ ...r, responseDays: r.responseDays as number | null })),
  ].sort((a, b) => (a.responseDays === null) === (b.responseDays === null) ? a.regulator.localeCompare(b.regulator) : a.responseDays === null ? -1 : 1);
  const deadlines = paginate(deadlineRows, deadlinePage, PAGE);
  const activeHolds = data.holds.filter((h) => !h.releasedAt);
  const holds = paginate(activeHolds, holdPage, PAGE);
  const runs = paginate(data.runs, runPage, PAGE);
  const windowDays = data.settings.purge.windowDays;
  const lastDry = data.runs.find((r) => r.mode === "dry_run" && r.finishedAt);
  const dryFresh = Boolean(lastDry && now - Date.parse(lastDry.finishedAt!) < windowDays * 86_400_000);
  const platformRule = (t: string) => data.rules.find((r) => r.tenantId === null && r.recordType === t && r.state === null) ?? null;
  const mine = (t: string) => data.rules.filter((r) => r.tenantId !== null && r.recordType === t);

  const tabs: { key: Tab; label: string; count?: number | null; tone?: "danger" }[] = [
    { key: "start", label: "Start here" },
    { key: "complaints", label: "Complaints", count: unset.length || null, tone: "danger" },
    { key: "records", label: "Records" },
    { key: "holds", label: "Holds & deletion", count: activeHolds.length || null },
    { key: "transfers", label: "Gate & reports" },
  ];
  const more = <MoreMenu items={[{ label: "History", href: "/app/settings?history=compliance#settings-history" }, { label: "Compliance dashboard", href: "/app/compliance" }, { label: "Calling windows", href: "/app/settings#calling-windows" }]} />;
  // A tab with its own buttons drops More: History is already on the line under the title, and five tabs
  // plus three buttons do not fit the title line at 1280.
  const actions = !readOnly && tab === "complaints" ? <Button asChild><Link href={`${SETTINGS_URL}/deadlines/new`}>Add deadline</Link></Button>
    : !readOnly && tab === "records" ? <><Button variant="outline" disabled={busy || dirty} onClick={() => void write("/api/app/compliance/retention/runs", { mode: "dry_run" }, "Dry run done")}>Dry run now</Button><Button disabled={busy || dirty || !dryFresh} title={dryFresh ? undefined : `A live run needs a dry run in the last ${windowDays} days`} onClick={() => setConfirmLive(true)}>Live run</Button></>
    : !readOnly && tab === "holds" ? <Button asChild><Link href={`${SETTINGS_URL}/holds/new`}>Place hold</Link></Button>
    : more;
  const lastDryMatched = lastDry ? lastDry.results.reduce((sum, r) => sum + Math.max(0, r.rows_matched - r.rows_held), 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <SectionTabs label="Compliance settings" tabs={tabs} value={tab} onChange={setTab} actions={actions} />
      <LeaveGuard dirty={dirty} onSave={save} onDiscard={discard} what="the compliance settings" />

      {tab === "start" && (
        <FormSections>
          <FormSection title="Complaint deadlines" info="A complaint from a state insurance department or the FTC counts down to its response deadline.">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-sm text-[var(--ink)]">{c.sentence}</p>
              <Button variant="outline" size="sm" onClick={() => setTab("complaints")}>Set deadlines</Button>
            </div>
          </FormSection>
          <FormSection title="Transfers from partners" info="What happens when a partner transfers a caller with no consent on file.">
            <SettingRow label="If a transfer has no consent on file" change="Flagged transfers are accepted and counted on the compliance dashboard and in the evidence report. Blocked ones are refused before the call reaches you.">
              <Segmented label="If a transfer has no consent on file" disabled={dis} value={v<"warn" | "block">("gate.consentMissing")} onChange={(next) => set("gate.consentMissing", next)} options={[{ key: "warn", label: "Accept and flag it" }, { key: "block", label: "Block the transfer" }]} />
            </SettingRow>
          </FormSection>
          <FormSection title="Old records" info="Whether records past their retention period are deleted on a schedule.">
            <SettingRow label="Delete records on a schedule" change={v<boolean>("purge.scheduleEnabled") ? `A dry run is emailed first; the live run follows after ${windowDays} days. Held records are never deleted.` : "Nothing is deleted unless you run it from the Records tab. A retention policy nobody enforces is a document, not a control."}>
              {onOff("purge.scheduleEnabled", "Delete records on a schedule")}
            </SettingRow>
            <LockedNote>The internal do-not-call list is never deleted, by anything.</LockedNote>
          </FormSection>
        </FormSections>
      )}

      {tab === "complaints" && (
        <FormSections>
          <div id="deadlines" className="scroll-mt-24">
            <SettingsTableCard title="Response deadlines" actions={<span className="text-sm text-[var(--muted)]">{unset.length ? `${unset.length} not set` : "Every licensed state is set"}</span>}>
              {deadlineRows.length === 0 ? <EmptyState title="No deadlines yet" hint="Add each licensed state's DOI response days, and the FTC's." /> : (
                <table className={st.table}>
                  <thead><tr className={st.headRow}><th className={st.th}>Regulator</th><th className={cn(st.th, "text-right")}>Days to respond</th><th className={st.th}>Source</th><th className={cn(st.th, "w-10")} aria-label="Open" /></tr></thead>
                  <tbody>{deadlines.rows.map((r) => {
                    const href = r.responseDays === null ? `${SETTINGS_URL}/deadlines/new?regulator=${r.regulator}` : `${SETTINGS_URL}/deadlines/${r.regulator}`;
                    return (
                      <tr key={r.regulator} className="cursor-pointer hover:bg-[var(--surface-alt)]" onClick={() => router.push(href)}>
                        <td className={st.td}><RowLink href={href}>{regulatorName(r.regulator)}</RowLink></td>
                        <td className={cn(st.td, st.num)}>{r.responseDays === null ? <span className="text-[var(--muted)]">Not set</span> : r.responseDays}</td>
                        <td className={st.td}>{r.notes ?? <span className="text-[var(--muted)]">—</span>}</td>
                        <td className={cn(st.td, "text-right text-[var(--muted)]")}><ChevronRight aria-hidden="true" className="ml-auto size-4" /></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
              {deadlineRows.length > PAGE && <div className="border-t border-[var(--border)] px-4 py-2"><Pager page={deadlines.current} total={deadlineRows.length} noun="regulators" pageSize={PAGE} onPage={setDeadlinePage} /></div>}
            </SettingsTableCard>
          </div>
          <FormSection title="When a complaint gets urgent" info="When a regulator complaint turns amber and red.">
            <SettingRow label="Turn a regulator complaint" change="Days left to respond. Inside red it pins to the top of the compliance dashboard and the owner gets a daily email.">
              <div className="flex flex-wrap gap-4">
                <span className="flex flex-col gap-1.5 text-label text-[var(--body)]">Amber with{num("complaints.amberDays", "Amber at (days left)", { min: 1, max: 90, unit: "days" })}</span>
                <span className="flex flex-col gap-1.5 text-label text-[var(--body)]">Red with{num("complaints.redDays", "Red at (days left)", { min: 1, max: 60, unit: "days" })}</span>
              </div>
            </SettingRow>
          </FormSection>
        </FormSections>
      )}

      {tab === "records" && (
        <FormSections>
          <div id="retention" className="scroll-mt-24">
            <SettingsTableCard title="How long records are kept">
              <table className={st.table}>
                <thead><tr className={st.headRow}><th className={st.th}>Record</th><th className={st.th}>Kept for</th><th className={st.th}>Then</th><th className={st.th}>Basis</th><th className={st.th}>Rule</th><th className={cn(st.th, "w-10")} aria-label="Open" /></tr></thead>
                <tbody>{RECORD_TYPES.map((t) => {
                  const p = platformRule(t.key);
                  const own = mine(t.key);
                  const shown = own.find((r) => r.state === null) ?? p;
                  const isLocked = data.caps.neverDelete.includes(t.key);
                  const href = `${SETTINGS_URL}/retention/${t.key}`;
                  return (
                    <tr key={t.key} className="cursor-pointer hover:bg-[var(--surface-alt)]" onClick={() => router.push(href)}>
                      <td className={st.td}><RowLink href={href}>{t.label}</RowLink></td>
                      <td className={st.td}>{shown ? describeDays(shown.retainDays) : <span className="text-[var(--muted)]">—</span>}{own.some((r) => r.state) ? <span className={st.sub}>{own.filter((r) => r.state).length} state rule{own.filter((r) => r.state).length === 1 ? "" : "s"}</span> : null}</td>
                      <td className={st.td}>{shown ? ACTION_LABELS[shown.action as RetentionAction] ?? shown.action : <span className="text-[var(--muted)]">—</span>}</td>
                      <td className={st.td}>{shown ? BASIS_LABELS[shown.basis as RetentionBasis] ?? shown.basis : <span className="text-[var(--muted)]">—</span>}</td>
                      <td className={st.td}>{isLocked ? <StatusChip tone="neutral">Locked: never deleted</StatusChip> : own.length ? <StatusChip tone="good">Yours · {own.length} rule{own.length === 1 ? "" : "s"}</StatusChip> : p ? <StatusChip tone="neutral" dot={false}>Insurvas</StatusChip> : <span className="text-[var(--muted)]">No rule: never deleted</span>}</td>
                      <td className={cn(st.td, "text-right text-[var(--muted)]")}><ChevronRight aria-hidden="true" className="ml-auto size-4" /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <p className="m-0 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">{NOT_LEGAL_ADVICE} Your rule for a state beats your all-states rule, which beats Insurvas&apos;s. A record type with no rule is never deleted. Insurvas keeps each carrier&apos;s retention windows.</p>
            </SettingsTableCard>
          </div>
          <FormSection id="purge" title="Scheduled purge" info="A dry run first, every time. A live run needs a dry run inside the window.">
            <SettingRow label="Delete records on a schedule" change="Each day a dry run is emailed first; the live run follows after the window. Also on Start here.">
              {onOff("purge.scheduleEnabled", "Run the purge on a schedule")}
            </SettingRow>
            <SettingRow label="A live run waits after a dry run" change="A live run, by hand or on schedule, needs a dry run inside this many days.">
              {num("purge.windowDays", "Dry-run-to-live window (days)", { min: 1, max: 30, unit: "days" })}
            </SettingRow>
            <SettingRow label="Email the dry-run summary to" change="They see what a live run would delete before it does.">
              <Recipients team={data.team} value={v<string[]>("purge.recipients") ?? []} disabled={dis} onChange={(ids) => set("purge.recipients", ids)} label="Dry-run summary recipients" />
            </SettingRow>
          </FormSection>
          <SettingsTableCard title="Runs">
            {data.runs.length === 0 ? <EmptyState title="No runs yet" hint="Start with a dry run: it deletes nothing and shows what a live run would." /> : (
              <table className={st.table}>
                <thead><tr className={st.headRow}><th className={st.th}>When</th><th className={st.th}>Mode</th><th className={cn(st.th, "text-right")}>Matched</th><th className={cn(st.th, "text-right")}>Held</th><th className={cn(st.th, "text-right")}>Deleted</th><th className={st.th}>Unruled</th><th className={cn(st.th, "w-10")} aria-label="Open" /></tr></thead>
                <tbody>{runs.rows.map((r) => {
                  const href = `${SETTINGS_URL}/runs/${r.id}`;
                  const sum = (k: "rows_matched" | "rows_held" | "rows_purged") => r.results.reduce((a, x) => a + (x[k] ?? 0), 0).toLocaleString("en-US");
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-[var(--surface-alt)]" onClick={() => router.push(href)}>
                      <td className={st.td}><RowLink href={href}>{dateTime(r.startedAt, viewerTimeZone())}</RowLink></td>
                      <td className={st.td}><StatusChip tone={r.mode === "live" ? "danger" : "info"}>{r.mode === "live" ? "Live" : "Dry run"}</StatusChip></td>
                      <td className={cn(st.td, st.num)}>{sum("rows_matched")}</td>
                      <td className={cn(st.td, st.num)}>{sum("rows_held")}</td>
                      <td className={cn(st.td, st.num)}>{sum("rows_purged")}</td>
                      <td className={st.td}>{r.unruled.length ? r.unruled.length : <span className="text-[var(--muted)]">—</span>}</td>
                      <td className={cn(st.td, "text-right text-[var(--muted)]")}><ChevronRight aria-hidden="true" className="ml-auto size-4" /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            {data.runs.length > PAGE && <div className="border-t border-[var(--border)] px-4 py-2"><Pager page={runs.current} total={data.runs.length} noun="runs" pageSize={PAGE} onPage={setRunPage} /></div>}
          </SettingsTableCard>
        </FormSections>
      )}

      {tab === "holds" && (
        <FormSections>
          <div id="holds" className="scroll-mt-24">
            <SettingsTableCard title="Legal holds" actions={<span className="text-sm text-[var(--muted)]">Nothing under a hold is deleted, by a schedule or a deletion request</span>}>
              {activeHolds.length === 0 ? <EmptyState title="No holds in force" hint="A complaint or a commission dispute places one by itself. Place one by hand for litigation." /> : (
                <table className={st.table}>
                  <thead><tr className={st.headRow}><th className={st.th}>Covers</th><th className={st.th}>Why</th><th className={st.th}>Placed</th><th className={st.th}>Note</th><th className={cn(st.th, "w-10")} aria-label="Open" /></tr></thead>
                  <tbody>{holds.rows.map((h) => {
                    const href = `${SETTINGS_URL}/holds/${h.id}`;
                    return (
                      <tr key={h.id} className="cursor-pointer hover:bg-[var(--surface-alt)]" onClick={() => router.push(href)}>
                        <td className={cn(st.td, "whitespace-nowrap")}><RowLink href={href}>{h.scopeValue ?? HOLD_SCOPE_LABELS[h.scope]}</RowLink>{h.scopeValue ? <span className={st.sub}>{HOLD_SCOPE_LABELS[h.scope].replace(/^A /, "")}</span> : null}</td>
                        <td className={cn(st.td, "whitespace-nowrap")}>{HOLD_REASON_LABELS[h.reason]}{h.automatic ? <span className={st.sub}>Automatic, from its {h.reason === "complaint" ? "complaint" : "dispute"}</span> : null}</td>
                        <td className={cn(st.td, "whitespace-nowrap")}>{dateTime(h.placedAt, viewerTimeZone())}</td>
                        <td className={st.td}>{h.note ?? <span className="text-[var(--muted)]">—</span>}</td>
                        <td className={cn(st.td, "text-right text-[var(--muted)]")}><ChevronRight aria-hidden="true" className="ml-auto size-4" /></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
              {activeHolds.length > PAGE && <div className="border-t border-[var(--border)] px-4 py-2"><Pager page={holds.current} total={activeHolds.length} noun="holds" pageSize={PAGE} onPage={setHoldPage} /></div>}
            </SettingsTableCard>
          </div>
          <FormSection id="deletion" title="Deletion requests" info="How a consumer's request to delete their data is checked and when it may run.">
            <SettingRow label="Wait after identity is verified" change={`The request can be cancelled during the wait. Insurvas never lets it go below ${data.caps.deletionHoldFloorDays} days.`}>
              {num("deletion.holdDays", "Hold after verification (days)", { min: data.caps.deletionHoldFloorDays, max: 45, unit: "days" })}
            </SettingRow>
            <SettingRow label="Ways to verify who is asking" change="A request that none of these can verify is rejected with the reason recorded.">
              <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                <legend className="sr-only">Accepted ways to verify identity</legend>
                {VERIFICATION_METHODS.map((m) => (
                  <label key={m} className="flex items-start gap-2 text-sm text-[var(--ink)]"><input type="checkbox" className={cn(checkboxControl, "mt-0.5")} checked={(v<string[]>("deletion.methods") ?? []).includes(m)} disabled={dis} onChange={(e) => set("deletion.methods", toggle(v<string[]>("deletion.methods") ?? [], m, e.target.checked))} />{METHOD_LABELS[m]}</label>
                ))}
              </fieldset>
            </SettingRow>
            <SettingRow label="Who may verify and perform a deletion">
              {locked("The owner", "Always")}
              <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label="Producers may perform deletions" checked={(v<string[]>("deletion.performerRoles") ?? []).includes("producer")} disabled={dis} onChange={(on) => set("deletion.performerRoles", on ? ["owner", "producer"] : ["owner"])} />Producers</span>
            </SettingRow>
          </FormSection>
        </FormSections>
      )}

      {tab === "transfers" && (
        <FormSections>
          <FormSection id="gate" title="Transfer gate" info="The checks run on a partner's transfer before it is accepted.">
            <SettingRow label="Checks on every transfer" change="A check that is off is not run on a partner's transfer.">
              {locked("TCPA litigator", "Always on")}
              {locked("Internal do-not-call list", "Always on")}
              {([["gate.federalDnc", "Federal and state do-not-call"], ["gate.consent", "Consent on file"], ["gate.existingCustomer", "Existing customer"], ["gate.callingHours", "Inside legal calling hours"]] as const).map(([key, label]) => (
                <span key={key} className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label={label} checked={Boolean(v<boolean>(key))} disabled={dis} onChange={(on) => set(key, on)} />{label}</span>
              ))}
            </SettingRow>
            <p className="m-0 text-sm text-[var(--muted)]">A transfer with no consent on file is {v<string>("gate.consentMissing") === "block" ? "blocked" : "accepted and flagged"}; change it on <button type="button" className="font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => setTab("start")}>Start here</button>. Calling windows are set in <Link className="underline" href="/app/settings#calling-windows">Settings › Calling windows</Link>; screening vendors are chosen by Insurvas.</p>
            <Advanced summary="Advanced" hint={`Wait up to ${(v<number>("gate.timeoutMs") ?? 0).toLocaleString("en-US")} ms for each check`}>
              <SettingRow label="Wait for each check up to" change="A check slower than this is recorded as incomplete, never as passed.">
                {num("gate.timeoutMs", "Time budget per check (ms)", { min: 500, max: 10000, step: 100, unit: "ms", width: "w-28" })}
              </SettingRow>
            </Advanced>
          </FormSection>
          <FormSection id="report" title="Evidence report" info="Which gap checks run, and who may generate a report.">
            <SettingRow label="Who may generate a report">
              {locked("The owner", "Always")}
              <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label="Producers may generate reports" checked={(v<string[]>("report.roles") ?? []).includes("producer")} disabled={dis} onChange={(on) => set("report.roles", on ? ["owner", "producer"] : ["owner"])} />Producers, for their own leads</span>
            </SettingRow>
            <Advanced summary="Gap checks" hint={`${(v<string[]>("report.gapChecks") ?? []).length} of ${GAP_CATEGORIES.length} on`}>
              <SettingRow label="Gap checks that run" change="A check that is off shows as off on every report, never as passed.">
                <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                  <legend className="sr-only">Gap checks</legend>
                  {GAP_CATEGORIES.map((g) => <label key={g.key} className="flex items-center gap-2 text-sm text-[var(--ink)]"><input type="checkbox" className={checkboxControl} checked={(v<string[]>("report.gapChecks") ?? []).includes(g.key)} disabled={dis} onChange={(e) => set("report.gapChecks", toggle(v<string[]>("report.gapChecks") ?? [], g.key, e.target.checked))} />{g.label}</label>)}
                </fieldset>
              </SettingRow>
            </Advanced>
            <p className="m-0 text-sm text-[var(--muted)]">No report copies are stored. Disclosures are edited in <Link className="underline" href="/app/settings#sales-disclosures">Settings › Disclosures</Link>.</p>
          </FormSection>
          <FormSection id="dashboard" title="Dashboard and monthly email" info="What the compliance dashboard shows, and the monthly coverage email.">
            <SettingRow label="Monthly coverage email" change="The coverage figures and the book-wide gap scan, once a month.">
              {onOff("dashboard.monthlyEmail", "Monthly coverage email")}
              {v<boolean>("dashboard.monthlyEmail") && <Recipients team={data.team} value={v<string[]>("dashboard.recipients") ?? []} disabled={dis} onChange={(ids) => set("dashboard.recipients", ids)} label="Monthly email recipients" />}
            </SettingRow>
            <Advanced summary="Tiles shown" hint={`${TILE_KEYS.length - (v<string[]>("dashboard.hiddenTiles") ?? []).length} of ${TILE_KEYS.length}`}>
              <SettingRow label="Tiles on the dashboard">
                <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                  <legend className="sr-only">Dashboard tiles</legend>
                  {TILE_KEYS.map((k) => <label key={k} className="flex items-center gap-2 text-sm text-[var(--ink)]"><input type="checkbox" className={checkboxControl} checked={!(v<string[]>("dashboard.hiddenTiles") ?? []).includes(k)} disabled={dis} onChange={(e) => set("dashboard.hiddenTiles", toggle(v<string[]>("dashboard.hiddenTiles") ?? [], k, !e.target.checked))} />{TILE_LABELS[k]}</label>)}
                </fieldset>
              </SettingRow>
            </Advanced>
          </FormSection>
        </FormSections>
      )}

      <SettingsSaveBar visible={!readOnly && dirty} note={`${changed.length} unsaved change${changed.length === 1 ? "" : "s"} to the compliance settings`}>
        <DraftActions dirty={dirty} saving={busy} onDiscard={discard} onSave={() => void save()} />
      </SettingsSaveBar>

      <ConfirmDialog open={confirmLive} onOpenChange={setConfirmLive} busy={busy}
        title={`Delete ${lastDryMatched.toLocaleString("en-US")} records now?`}
        description={`This deletes what the ${lastDry ? dateTime(lastDry.startedAt, viewerTimeZone()) : "last"} dry run listed, and anything that came due since. Held records and the do-not-call list are not touched. It cannot be undone.`}
        confirmLabel="Run the purge" cancelLabel="Not now"
        onConfirm={async () => { if (await write("/api/app/compliance/retention/runs", { mode: "live", confirm: true }, "Live run done")) setConfirmLive(false); }} />
    </div>
  );
}
