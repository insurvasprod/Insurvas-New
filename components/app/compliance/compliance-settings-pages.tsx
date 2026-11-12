"use client";

import { useRouteSheet } from "@/components/app/route-sheet";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { STATES, SETTINGS_URL, regulatorName, useComplianceBundle, type Bundle } from "@/components/app/compliance/compliance-settings-data";
import { FormSection, FormSections } from "@/components/app/settings/patterns";
import { SettingsSectionHeader, SettingsTableCard, st } from "@/components/app/settings/primitives";
import { LockedNote, SettingRow } from "@/components/app/settings/setting-row";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { inputControl, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { ACTION_LABELS, BASES, BASIS_LABELS, HOLD_REASON_LABELS, HOLD_SCOPE_LABELS, NOT_LEGAL_ADVICE, RECORD_TYPES, describeDays, type HoldReason, type HoldScope, type RetentionAction, type RetentionBasis } from "@/lib/compliance/retention";
import { cn } from "@/lib/utils";

/**
 * The record pages under Settings › Compliance (Money & compliance redesign A, 2026-11-03): a list
 * on the settings page opens one of these. Forms are pages; pop-ups only confirm. Each write goes to
 * the same route the settings page always used, so what is saved and audited is unchanged.
 */

function Crumbs({ tab, anchor, here, aside }: { tab: string; anchor: string; here: ReactNode; aside?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <Link className="text-[var(--muted)] hover:text-[var(--ink)]" href={`${SETTINGS_URL}#${anchor}`}>{tab}</Link>
      <ChevronRight aria-hidden="true" className="size-4 text-[var(--muted)]" />
      <span className="font-semibold text-[var(--ink)]">{here}</span>
      {aside}
    </span>
  );
}

/** Loads the bundle, then draws the page; a load error or a missing record says so in place. */
function WithBundle({ children }: { children: (b: ReturnType<typeof useComplianceBundle> & { data: Bundle }) => ReactNode }) {
  const bundle = useComplianceBundle();
  if (bundle.error) return <ErrorState detail={bundle.error} action={<Button variant="outline" onClick={bundle.reload}>Try again</Button>} />;
  if (!bundle.data) return <TableCard><SectionLoading rows={5} columns={3} /></TableCard>;
  return <>{children(bundle as ReturnType<typeof useComplianceBundle> & { data: Bundle })}</>;
}
const Missing = ({ what, back }: { what: string; back: string }) => <TableCard><EmptyState title={`That ${what} is not here`} hint="It may have been removed." action={<Button asChild variant="outline"><Link href={back}>Back to Compliance settings</Link></Button>} /></TableCard>;
const FormFoot = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap justify-end gap-2.5">{children}</div>;

/* ── a complaint deadline ── */

export function DeadlinePage({ regulator, preset, readOnly }: { regulator: string | null; preset?: string | null; readOnly: boolean }) {
  return <WithBundle>{(b) => <DeadlineForm bundle={b} regulator={regulator} preset={preset ?? null} readOnly={readOnly} />}</WithBundle>;
}

function DeadlineForm({ bundle, regulator, preset, readOnly }: { bundle: ReturnType<typeof useComplianceBundle> & { data: Bundle }; regulator: string | null; preset: string | null; readOnly: boolean }) {
  const router = useRouter();
  const sheet = useRouteSheet();
  const { data, busy, write } = bundle;
  const existing = regulator ? data.deadlines.rows.find((r) => r.regulator === regulator) ?? null : null;
  const set = new Set(data.deadlines.rows.map((r) => r.regulator));
  const missing = new Set(data.deadlines.coverage.missing);
  const choices = ["FTC", ...STATES].filter((s) => !set.has(s)).sort((a, b) => Number(missing.has(b) || (b === "FTC" && !data.deadlines.coverage.ftc)) - Number(missing.has(a) || (a === "FTC" && !data.deadlines.coverage.ftc)));
  const [pick, setPick] = useState(() => regulator ?? (preset && choices.includes(preset) ? preset : ""));
  const [days, setDays] = useState(existing ? String(existing.responseDays) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [removing, setRemoving] = useState(false);
  const back = `${SETTINGS_URL}#deadlines`;
  if (regulator && !existing) return <Missing what="deadline" back={back} />;
  const dirty = existing ? days !== String(existing.responseDays) || notes !== (existing.notes ?? "") : Boolean(pick || days || notes);
  const valid = Boolean(pick) && /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 180;
  const save = async () => {
    const ok = await write("/api/app/compliance/settings", { op: "deadline", regulator: pick, response_days: Number(days), notes: notes.trim() || null }, existing ? `${regulatorName(pick)} deadline saved` : `Deadline set for ${regulatorName(pick)}`);
    if (ok) router.push(back);
    return ok;
  };
  return (
    <div className="flex flex-col gap-6">
      {/* In a route sheet the panel names it (route-sheet.tsx). */}
      {!sheet && <SettingsSectionHeader trail={<Crumbs tab="Complaints" anchor="deadlines" here={existing ? regulatorName(existing.regulator) : "Add a deadline"} />} />}
      <LeaveGuard dirty={dirty && !busy} onSave={valid ? save : undefined} onDiscard={() => undefined} what="this deadline" />
      <FormSections>
        <FormSection title={existing ? "Response deadline" : "A new response deadline"} info="Statutory days to answer a state insurance department or the FTC. Unset means no countdown, never a guessed default.">
          {!existing && (
            <SettingRow label="Regulator" change={pick && missing.has(pick) ? "A licensed state with no deadline yet." : undefined}>
              <select aria-label="Regulator" className={cn(inputControl, "w-72")} disabled={readOnly} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a regulator</option>
                {choices.map((s) => <option key={s} value={s}>{regulatorName(s)}{missing.has(s) || (s === "FTC" && !data.deadlines.coverage.ftc) ? " · licensed, not set" : ""}</option>)}
              </select>
            </SettingRow>
          )}
          <SettingRow label="Days to respond" change={pick ? `Every new ${regulatorName(pick)} complaint counts down from this.` : "Every new complaint from this regulator counts down from this."}>
            <span className="flex items-center gap-2 text-sm text-[var(--muted)]"><input aria-label="Days to respond" className={cn(inputControl, "w-24 tabular-nums")} disabled={readOnly} type="number" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} />days</span>
          </SettingRow>
          <SettingRow label="Source" sub="Optional" change="Where the number comes from, for whoever checks it next.">
            <input aria-label="Source" className={cn(inputControl, "max-w-[560px]")} disabled={readOnly} maxLength={500} placeholder="e.g. 28 TAC §21.2804: 15 days from receipt" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </SettingRow>
        </FormSection>
        {!readOnly && (
          <FormFoot>
            {existing && <Button variant="outline" className="mr-auto text-[var(--error-ink)]" disabled={busy} onClick={() => setRemoving(true)}>Remove deadline</Button>}
            <Button asChild variant="outline"><Link href={back}>Cancel</Link></Button>
            <Button disabled={busy || !valid || !dirty} onClick={() => void save()}>{existing ? "Save" : "Add deadline"}</Button>
          </FormFoot>
        )}
      </FormSections>
      {existing && (
        <ConfirmDialog open={removing} onOpenChange={setRemoving} busy={busy}
          title={`Remove the ${regulatorName(existing.regulator)} deadline?`}
          description={`New complaints from ${existing.regulator === "FTC" ? "the FTC" : existing.regulator} will have no countdown, no amber or red and no daily email. Open complaints keep their due dates.`}
          confirmLabel="Remove deadline" cancelLabel="Keep deadline"
          onConfirm={async () => { if (await write("/api/app/compliance/settings", { op: "deadline", regulator: existing.regulator, response_days: null }, "Deadline removed")) router.push(back); }} />
      )}
    </div>
  );
}

/* ── a record type's retention rules ── */

export function RecordTypePage({ recordType, readOnly }: { recordType: string; readOnly: boolean }) {
  return <WithBundle>{(b) => <RecordTypeView bundle={b} recordType={recordType} readOnly={readOnly} />}</WithBundle>;
}

function RecordTypeView({ bundle, recordType, readOnly }: { bundle: ReturnType<typeof useComplianceBundle> & { data: Bundle }; recordType: string; readOnly: boolean }) {
  const { data, busy, write } = bundle;
  const type = RECORD_TYPES.find((t) => t.key === recordType);
  const platform = data.rules.find((r) => r.tenantId === null && r.recordType === recordType && r.state === null) ?? null;
  const mine = data.rules.filter((r) => r.tenantId !== null && r.recordType === recordType).sort((a, b) => (a.state ?? "").localeCompare(b.state ?? ""));
  const isLocked = data.caps.neverDelete.includes(recordType);
  const blank = { state: "", days: String(platform?.retainDays ?? 1461), action: (platform?.action === "anonymise" ? "anonymise" : "purge") as "purge" | "anonymise", basis: "our_policy" as RetentionBasis, notes: "" };
  const [form, setForm] = useState(blank);
  const [removing, setRemoving] = useState<string | null>(null);
  if (!type) return <Missing what="record type" back={`${SETTINGS_URL}#retention`} />;
  const valid = /^\d+$/.test(form.days) && Number(form.days) >= 30 && Number(form.days) <= 7300;
  const editing = mine.find((r) => (r.state ?? "") === form.state);
  const dirty = JSON.stringify(form) !== JSON.stringify(blank);
  const saveRule = async () => {
    const ok = await write("/api/app/compliance/settings", { op: "rule", record_type: recordType, state: form.state || null, retain_days: Number(form.days), action: form.action, basis: form.basis, notes: form.notes.trim() || null }, "Rule saved");
    if (ok) setForm(blank);
    return ok;
  };
  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader trail={<Crumbs tab="Records" anchor="retention" here={type.label} />} actions={!readOnly && !isLocked && platform && mine.length === 0 ? <Button variant="outline" disabled={busy} onClick={() => void write("/api/app/compliance/settings", { op: "copy_rule", record_type: recordType }, "Copied to your agency")}>Copy to my agency</Button> : undefined} />
      <LeaveGuard dirty={dirty && !busy} onSave={valid ? saveRule : undefined} onDiscard={() => setForm(blank)} what="this rule" />
      <FormSections>
        <FormSection title="Insurvas default" info="The period every agency starts with. Your rules beat it.">
          {isLocked ? <LockedNote>Do-not-call entries are never deleted, by anything. This rule cannot be changed.</LockedNote>
            : platform ? (
              <dl className="m-0 grid gap-x-6 gap-y-1.5 text-sm @xl:grid-cols-[12rem_minmax(0,1fr)]">
                <dt className="text-[var(--muted)]">Kept for</dt><dd className="m-0 text-[var(--ink)]">{describeDays(platform.retainDays)}, then {ACTION_LABELS[platform.action as RetentionAction]?.toLowerCase() ?? platform.action}</dd>
                <dt className="text-[var(--muted)]">Basis</dt><dd className="m-0 text-[var(--ink)]">{BASIS_LABELS[platform.basis as RetentionBasis] ?? platform.basis}</dd>
              </dl>
            ) : <p className="m-0 text-sm text-[var(--ink)]"><StatusChip tone="warning">No rule</StatusChip> Insurvas has no default for this type, so it is never deleted until you add a rule.</p>}
          <p className="m-0 text-xs text-[var(--muted)]">{NOT_LEGAL_ADVICE}</p>
        </FormSection>
        {!isLocked && (
          <SettingsTableCard title="Your rules" actions={<span className="text-sm text-[var(--muted)]">A state rule beats your all-states rule</span>}>
            {mine.length === 0 ? <EmptyState title="No rules of your own" hint="Insurvas's default applies. Add a rule below, for all states or one." /> : (
              <table className={st.table}>
                <thead><tr className={st.headRow}><th className={st.th}>State</th><th className={st.th}>Kept for</th><th className={st.th}>Then</th><th className={st.th}>Basis</th><th className={st.th}>Notes</th><th className={cn(st.th, "w-0")} aria-label="Actions" /></tr></thead>
                <tbody>{mine.map((r) => (
                  <tr key={r.id}>
                    <td className={cn(st.td, st.strong)}>{r.state ?? "All states"}</td>
                    <td className={st.td}>{describeDays(r.retainDays)}</td>
                    <td className={st.td}>{ACTION_LABELS[r.action as RetentionAction] ?? r.action}</td>
                    <td className={st.td}>{BASIS_LABELS[r.basis as RetentionBasis] ?? r.basis}</td>
                    <td className={st.td}>{r.notes ?? <span className="text-[var(--muted)]">—</span>}</td>
                    <td className={cn(st.td, "whitespace-nowrap text-right")}>{!readOnly && <span className="inline-flex gap-2"><Button size="sm" variant="outline" onClick={() => setForm({ state: r.state ?? "", days: String(r.retainDays ?? ""), action: r.action === "anonymise" ? "anonymise" : "purge", basis: (r.basis as RetentionBasis) ?? "our_policy", notes: r.notes ?? "" })}>Change</Button><Button size="sm" variant="outline" onClick={() => setRemoving(r.id)}>Remove</Button></span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </SettingsTableCard>
        )}
        {!isLocked && !readOnly && (
          <FormSection title={editing ? `Change the ${editing.state ?? "all-states"} rule` : "Add a rule"} info="Saving a rule for a state that already has one replaces it.">
            <SettingRow label="State">
              <select aria-label="State" className={cn(inputControl, "w-48")} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}><option value="">All states</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </SettingRow>
            <SettingRow label="Keep for" change={valid ? describeDays(Number(form.days)) : "Between 30 and 7,300 days."}>
              <span className="flex items-center gap-2 text-sm text-[var(--muted)]"><input aria-label="Keep for (days)" className={cn(inputControl, "w-28 tabular-nums")} type="number" min={30} max={7300} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />days</span>
            </SettingRow>
            <SettingRow label="Then" change="Anonymise strips the personal fields and keeps the row, so totals still add up.">
              <Segmented label="Then" value={form.action} onChange={(action) => setForm({ ...form, action })} options={[{ key: "purge", label: "Delete" }, { key: "anonymise", label: "Anonymise, keep" }]} />
            </SettingRow>
            <SettingRow label="Where the number comes from">
              <select aria-label="Basis" className={cn(inputControl, "w-60")} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as RetentionBasis })}>{BASES.map((b) => <option key={b} value={b}>{BASIS_LABELS[b]}</option>)}</select>
            </SettingRow>
            <SettingRow label="Notes" sub="Optional">
              <input aria-label="Notes" className={cn(inputControl, "max-w-[560px]")} maxLength={500} placeholder="e.g. counsel's advice of 3 March" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </SettingRow>
            <FormFoot>
              {dirty && <Button variant="outline" disabled={busy} onClick={() => setForm(blank)}>Clear</Button>}
              <Button disabled={busy || !valid} onClick={() => void saveRule()}>{editing ? "Save rule" : "Add rule"}</Button>
            </FormFoot>
          </FormSection>
        )}
      </FormSections>
      <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} busy={busy}
        title="Remove this rule?" description="Your next broader rule applies instead: your all-states rule, then Insurvas's default." confirmLabel="Remove rule" cancelLabel="Keep rule"
        onConfirm={async () => { if (removing && await write("/api/app/compliance/settings", { op: "delete_rule", id: removing }, "Rule removed")) setRemoving(null); }} />
    </div>
  );
}

/* ── legal holds ── */

export function NewHoldPage({ readOnly }: { readOnly: boolean }) {
  return <WithBundle>{(b) => <NewHold bundle={b} readOnly={readOnly} />}</WithBundle>;
}

function NewHold({ bundle, readOnly }: { bundle: ReturnType<typeof useComplianceBundle> & { data: Bundle }; readOnly: boolean }) {
  const router = useRouter();
  const sheet = useRouteSheet();
  const { busy, write } = bundle;
  const [scope, setScope] = useState<HoldScope>("phone_digits");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<HoldReason>("litigation");
  const [note, setNote] = useState("");
  const back = `${SETTINGS_URL}#holds`;
  const valid = Boolean(note.trim()) && (scope === "tenant_wide" || Boolean(value.trim()));
  const dirty = Boolean(value || note);
  const place = async () => {
    const ok = await write("/api/app/compliance/retention/holds", { scope, value: scope === "tenant_wide" ? null : value.trim(), reason, note: note.trim() }, "Hold placed");
    if (ok) router.push(back);
    return ok;
  };
  return (
    <div className="flex flex-col gap-6">
      {!sheet && <SettingsSectionHeader trail={<Crumbs tab="Holds & deletion" anchor="holds" here="Place a hold" />} />}
      <LeaveGuard dirty={dirty && !busy} onSave={valid ? place : undefined} onDiscard={() => undefined} what="this hold" />
      <FormSections>
        <FormSection title="A legal hold" info="Records under a hold are never deleted, by the purge or a deletion request, until you release it.">
          <SettingRow label="Covers">
            <Segmented label="Covers" value={scope} onChange={setScope} options={(["phone_digits", "policy_number", "tenant_wide"] as const).map((key) => ({ key, label: HOLD_SCOPE_LABELS[key] }))} />
          </SettingRow>
          {scope !== "tenant_wide" && (
            <SettingRow label={scope === "phone_digits" ? "Phone number" : "Policy number"}>
              <input aria-label={scope === "phone_digits" ? "Phone number" : "Policy number"} className={cn(inputControl, "w-72")} value={value} onChange={(e) => setValue(e.target.value)} />
            </SettingRow>
          )}
          <SettingRow label="Why">
            <Segmented label="Why" value={reason} onChange={setReason} options={(["litigation", "regulator_inquiry", "manual"] as const).map((key) => ({ key, label: HOLD_REASON_LABELS[key] }))} />
          </SettingRow>
          <SettingRow label="Note" sub="Required" change="Nothing this hold covers is deleted until you release it.">
            <input aria-label="Note" className={cn(inputControl, "max-w-[560px]")} maxLength={500} placeholder="e.g. Demand letter received 1 Nov" value={note} onChange={(e) => setNote(e.target.value)} />
          </SettingRow>
        </FormSection>
        <FormFoot>
          <Button asChild variant="outline"><Link href={back}>Cancel</Link></Button>
          <Button disabled={readOnly || busy || !valid} onClick={() => void place()}>Place hold</Button>
        </FormFoot>
      </FormSections>
    </div>
  );
}

export function HoldPage({ id, readOnly }: { id: string; readOnly: boolean }) {
  return <WithBundle>{(b) => <HoldView bundle={b} id={id} readOnly={readOnly} />}</WithBundle>;
}

function HoldView({ bundle, id, readOnly }: { bundle: ReturnType<typeof useComplianceBundle> & { data: Bundle }; id: string; readOnly: boolean }) {
  const router = useRouter();
  const { data, busy, write } = bundle;
  const hold = data.holds.find((h) => h.id === id);
  const [releasing, setReleasing] = useState(false);
  const [why, setWhy] = useState("");
  const back = `${SETTINGS_URL}#holds`;
  if (!hold) return <Missing what="hold" back={back} />;
  const zone = viewerTimeZone();
  const placedBy = data.team.find((t) => t.id === hold.placedBy)?.name;
  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        trail={<Crumbs tab="Holds & deletion" anchor="holds" here={`${HOLD_SCOPE_LABELS[hold.scope]}${hold.scopeValue ? `: ${hold.scopeValue}` : ""}`} aside={hold.releasedAt ? <StatusChip tone="neutral">Released</StatusChip> : hold.sourceOpen ? <StatusChip tone="warning">{hold.reason === "complaint" ? "Complaint open" : "Dispute open"}</StatusChip> : <StatusChip tone="good">In force</StatusChip>} />}
        // Round 7 (Notion LA-6.6): an automatic hold whose complaint or dispute is still open cannot be released (the
        // database refuses it), so its button is off and says why instead of failing after the confirm.
        actions={!readOnly && !hold.releasedAt ? (hold.sourceOpen
          ? <Button variant="outline" disabled title={`Released automatically when its ${hold.reason === "complaint" ? "complaint" : "dispute"} is closed`}>Release hold</Button>
          : <Button variant="outline" disabled={busy} onClick={() => { setWhy(""); setReleasing(true); }}>Release hold</Button>) : undefined} />
      <FormSections>
        <FormSection title="This hold" info="Nothing it covers is deleted, by the purge or a deletion request, while it is in force.">
          <dl className="m-0 grid gap-x-6 gap-y-1.5 text-sm @xl:grid-cols-[12rem_minmax(0,1fr)]">
            <dt className="text-[var(--muted)]">Covers</dt><dd className="m-0 text-[var(--ink)]">{HOLD_SCOPE_LABELS[hold.scope]}{hold.scopeValue ? `: ${hold.scopeValue}` : ""}</dd>
            <dt className="text-[var(--muted)]">Why</dt><dd className="m-0 text-[var(--ink)]">{HOLD_REASON_LABELS[hold.reason]}{hold.automatic ? `, placed automatically by its ${hold.reason === "complaint" ? "complaint" : "dispute"}` : ""}</dd>
            <dt className="text-[var(--muted)]">Placed</dt><dd className="m-0 text-[var(--ink)]">{dateTime(hold.placedAt, zone)}{placedBy ? ` by ${placedBy}` : ""}</dd>
            <dt className="text-[var(--muted)]">Note</dt><dd className="m-0 text-[var(--ink)]">{hold.note ?? "—"}</dd>
            {hold.releasedAt && <><dt className="text-[var(--muted)]">Released</dt><dd className="m-0 text-[var(--ink)]">{dateTime(hold.releasedAt, zone)}{hold.releaseNote ? `: ${hold.releaseNote}` : ""}</dd></>}
          </dl>
          {hold.sourceOpen && <LockedNote>An automatic hold is released only once its {hold.reason === "complaint" ? "complaint" : "dispute"} is closed.</LockedNote>}
        </FormSection>
      </FormSections>
      <ConfirmDialog open={releasing} onOpenChange={setReleasing} busy={busy}
        title="Release this hold?" description={hold.automatic ? "An automatic hold is released only once its complaint or dispute is closed." : "From now on the records it covered can be deleted on schedule."}
        confirmLabel="Release hold" cancelLabel="Keep hold" confirmDisabled={!why.trim()}
        fields={<label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Why it is released<textarea className={cn(textareaControl, "mt-0")} value={why} onChange={(e) => setWhy(e.target.value)} /></label>}
        onConfirm={async () => { if (await write("/api/app/compliance/retention/holds", { id: hold.id, note: why.trim() }, "Hold released", "PATCH")) { setReleasing(false); router.push(back); } }} />
    </div>
  );
}

/* ── a purge run ── */

export function RunPage({ id }: { id: string }) {
  return <WithBundle>{(b) => <RunView data={b.data} id={id} />}</WithBundle>;
}

function RunView({ data, id }: { data: Bundle; id: string }) {
  const run = data.runs.find((r) => r.id === id);
  if (!run) return <Missing what="run" back={`${SETTINGS_URL}#purge`} />;
  const zone = viewerTimeZone();
  const label = (key: string) => RECORD_TYPES.find((t) => t.key === key)?.label ?? key;
  const day = (v?: string | null) => (v ? String(v).slice(0, 10) : "—");
  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader trail={<Crumbs tab="Records" anchor="purge" here={dateTime(run.startedAt, zone)} aside={<StatusChip tone={run.mode === "live" ? "danger" : "info"}>{run.mode === "live" ? "Live" : "Dry run"}</StatusChip>} />} />
      <SettingsTableCard title="Per record type" actions={<span className="text-sm text-[var(--muted)]">{run.mode === "live" ? "What was deleted" : "What a live run would delete"}</span>}>
        <table className={st.table}>
          <thead><tr className={st.headRow}><th className={st.th}>Record</th><th className={cn(st.th, "text-right")}>Matched</th><th className={cn(st.th, "text-right")}>Held</th><th className={cn(st.th, "text-right")}>{run.mode === "live" ? "Deleted" : "Would delete"}</th><th className={st.th}>Oldest</th><th className={st.th}>Newest</th></tr></thead>
          <tbody>{run.results.map((r, i) => (
            <tr key={`${r.record_type}-${r.table ?? i}`}>
              <td className={cn(st.td, "text-[var(--ink)]")}>{label(r.record_type)}{r.note || (r.table && run.results.filter((x) => x.record_type === r.record_type).length > 1) ? <span className={st.sub}>{r.note ?? `Table ${r.table}`}</span> : null}</td>
              <td className={cn(st.td, st.num)}>{r.rows_matched.toLocaleString("en-US")}</td>
              <td className={cn(st.td, st.num)}>{r.rows_held.toLocaleString("en-US")}</td>
              <td className={cn(st.td, st.num)}>{(run.mode === "live" ? r.rows_purged : Math.max(0, r.rows_matched - r.rows_held)).toLocaleString("en-US")}</td>
              <td className={st.td}>{day(r.oldest)}</td>
              <td className={st.td}>{day(r.newest)}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="m-0 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">{run.unruled.length ? `No rule, so nothing deleted: ${run.unruled.map(label).join(", ")}.` : "Every record type had a rule."} Started by {run.triggeredBy === "schedule" ? "the schedule" : run.triggeredBy === "manual" ? "a person" : run.triggeredBy}{run.finishedAt ? `, finished ${dateTime(run.finishedAt, zone)}` : ", still running"}.</p>
      </SettingsTableCard>
    </div>
  );
}
