"use client";

import { DismissButton } from "@/components/app/route-sheet";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Field, checkboxControl, control, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CHANNELS,
  COMPLAINT_OUTCOMES,
  COMPLAINT_STATUSES,
  COMPLAINT_VIA,
  OUTCOME_LABELS,
  STATUS_LABELS,
  VIA_LABELS,
  type ComplaintCategory,
  type ComplaintChannel,
  type CountdownTone,
  type Thresholds,
} from "@/lib/compliance/complaints";
import type { ComplaintRow, Respondent } from "@/lib/compliance/complaintStore";
import { complaintChannel, complaintChip, complaintName } from "@/lib/compliance/complaintView";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { dayMonthYear } from "@/lib/format/dates";
import { ViewTabs } from "@/components/app/view-tabs";
import { ComplianceSlot } from "@/components/app/compliance/compliance-slot";

/**
 * LA-6.4 · complaints: days remaining first, amber at 10, red at 5, overdue loudest. The response is typed
 * by the agent; nothing here drafts it.
 *
 * Foundation pass (2026-11-03, docs/compliance/FOUNDATION-PASS.md), as Book of business: one pattern, list
 * page → record page → tabs.
 *   /app/complaints            the list; Not resolved · Due soon · All on the title line (`?view=`), the
 *                              figures link to them, Record a complaint is the one primary. The most urgent
 *                              complaint goes to the bell, never a line on the page.
 *   /app/complaints/new        Record a complaint (was a 620px pop-up), with a leave guard.
 *   /app/complaints/[id]       the record (was a side panel): title, countdown chip, one facts line; Save and
 *                              More; tabs Complaint · Response · Files (`?tab=`).
 */
type Person = { id: string; name: string; role: string };
type Coverage = { licensed: number; covered: number; missing: string[]; ftc: boolean; sentence: string };
export type ComplaintView = "open" | "due" | "all";

/** "16 Oct 2026", as every Compliance step dates things. */
const day = (iso: string | null) => (iso ? dayMonthYear(iso) : "—");
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const DUE = new Set<CountdownTone>(["overdue", "red", "amber", "no_deadline"]);

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

/* ── /app/complaints ───────────────────────────────────────────────────── */

export function ComplaintsBoard({ complaints, coverage, thresholds, search, view, isOwner, readOnly }: { complaints: ComplaintRow[]; coverage: Coverage; thresholds: Thresholds; search: string; view: ComplaintView; isOwner: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(search);
  const [page, setPage] = useState(1);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const openRows = useMemo(() => complaints.filter((c) => c.status !== "resolved"), [complaints]);
  const dueRows = useMemo(() => openRows.filter((c) => DUE.has(c.countdown.tone)), [openRows]);
  const visible = view === "all" ? complaints : view === "due" ? dueRows : openRows;
  const pageSize = useFittingPageSize(480, 45);
  const shown = paginate(visible, page, pageSize);
  const pinned = complaints.filter((c) => c.countdown.pinned).length;
  const overdue = complaints.filter((c) => c.countdown.tone === "overdue").length;
  const regulator = openRows.filter((c) => c.channel === "doi" || c.channel === "ftc").length;
  const noDeadline = complaints.filter((c) => c.countdown.tone === "no_deadline").length;
  const href = (next: ComplaintView) => { const p = new URLSearchParams(); if (next !== "open") p.set("view", next); if (q.trim()) p.set("q", q.trim()); return p.size ? `/app/complaints?${p}` : "/app/complaints"; };
  // No notice on the page (owner 2026-11-02, r7 2026-11-11): the overdue complaint is the shell's banner and a
  // chip on its row; a regulator with no days, or licensed states with none, is the No deadline set tile's chip.
  const unsetStates = isOwner ? coverage.missing.length : 0;

  useEffect(() => {
    const t = setTimeout(() => { if (q !== search) router.replace(href(view)); }, 350);
    return () => clearTimeout(t);
  }, [q, search, router, view]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <ComplianceSlot slot="lead">
        <ViewTabs label="Which complaints" idPrefix="complaints-view" value={view}
          tabs={[
            { key: "open", label: "Not resolved", count: openRows.length, href: href("open") },
            { key: "due", label: "Due soon", count: dueRows.length || null, tone: "danger", href: href("due") },
            { key: "all", label: "All", count: complaints.length, href: href("all") },
          ]} />
      </ComplianceSlot>
      {!readOnly ? <ComplianceSlot slot="corner"><Button asChild><Link href="/app/complaints/new"><Plus aria-hidden="true" />Record a complaint</Link></Button></ComplianceSlot> : null}
      <StatStrip label="Complaint totals">
        <StatTile label="Open" value={String(openRows.length)} footnote={`${complaints.length} on record`} href={href("open")} />
        <StatTile label="Regulator" value={String(regulator)} footnote="DOI and FTC, open" href={href("open")} />
        <StatTile label={`Due within ${thresholds.redDays} days`} value={String(pinned)} footnote={overdue ? <StatusChip tone="danger">{overdue} overdue</StatusChip> : "or overdue"} href={href("due")} />
        <StatTile label="No deadline set" value={String(noDeadline)}
          footnote={noDeadline ? <StatusChip tone="warning">Set the days</StatusChip> : unsetStates ? <span title={coverage.sentence}><StatusChip tone="warning">{unsetStates} {unsetStates === 1 ? "state" : "states"} without days</StatusChip></span> : "regulator complaints"}
          href={isOwner && (noDeadline || coverage.missing.length) ? "/app/compliance/settings#deadlines" : href("due")} />
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
            <ToolbarSearch value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search complaints and responses" />
          </DataToolbar>
        }
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun={visible.length === 1 ? "complaint" : "complaints"} onPage={setPage} /> : undefined}
      >
        {complaints.length === 0 && !search ? (
          <EmptyState title="No complaints recorded" hint="Record one the day it arrives: a regulator's deadline starts counting then." action={!readOnly ? <Button asChild><Link href="/app/complaints/new">Record a complaint</Link></Button> : undefined} />
        ) : visible.length === 0 ? (
          search ? <NoMatches noun="complaints" onClear={() => setQ("")} /> : <EmptyState title={view === "due" ? "Nothing is due soon" : "Every complaint is resolved"} hint="Resolved complaints stay under All." />
        ) : (
          // One line a complaint, one text colour, one chip (r7 4·A): the chip carries the countdown. The whole
          // row opens the record; the name is its link for the keyboard. Phone and "via firm" are the name's tooltip.
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>Complainant</th><th>About</th><th>Made to</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {shown.rows.map((c) => {
                const chip = complaintChip(c);
                const name = complaintName(c);
                const tip = [name, c.phoneDigits ? formatPhone(c.phoneDigits) : null, c.partner ? `via ${c.partner.name}` : null].filter(Boolean).join(" · ");
                return (
                  <tr key={c.id} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(`/app/complaints/${c.id}`); }}>
                    <td className="max-w-[240px] truncate whitespace-nowrap font-medium text-foreground" title={tip}><Link href={`/app/complaints/${c.id}`} className="hover:underline">{name}</Link></td>
                    <td className="max-w-[200px] truncate whitespace-nowrap">{CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category}</td>
                    <td className="max-w-[200px] truncate whitespace-nowrap">{complaintChannel(c)}</td>
                    <td className="max-w-[180px] truncate whitespace-nowrap" title={c.owner.name}>{c.owner.name}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{day(c.responseDueAt)}</td>
                    <td className="whitespace-nowrap" title={c.countdown.tone === "none" ? undefined : c.countdown.label}><StatusChip tone={chip.tone}>{chip.label}</StatusChip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

/* ── /app/complaints/new ───────────────────────────────────────────────── */

export function NewComplaintForm({ team, partners }: { team: Person[]; partners: { id: string; name: string }[] }) {
  const router = useRouter();
  const blank = { channel: "agent" as ComplaintChannel, regulator_state: "", received_at: new Date().toISOString().slice(0, 10), received_via: "phone", complainant_name: "", phone: "", policy_number: "", category: "unwanted_calls" as ComplaintCategory, summary: "", owner_user_id: "", about_agent_user_id: "", partner_id: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const scope = useRef<HTMLFormElement>(null);
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const dirty = Boolean(f.summary || f.phone || f.complainant_name || f.policy_number);
  const save = async (): Promise<boolean> => {
    // A problem is a toast, never a notice on the page (r7 2026-11-11).
    if (!f.summary.trim()) { notify.block("Write what the complaint says."); return false; }
    if (f.category === "unwanted_calls" && !f.phone.trim()) { notify.block("A complaint about unwanted calls needs the number."); return false; }
    if (f.channel === "doi" && !f.regulator_state) { notify.block("Choose which state's department it was made to."); return false; }
    setBusy(true);
    try {
      const body = await send("/api/app/compliance/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: f.channel, regulator_state: f.channel === "doi" ? f.regulator_state || null : null,
          received_at: f.received_at ? new Date(`${f.received_at}T12:00:00Z`).toISOString() : null, received_via: f.received_via,
          complainant_name: f.complainant_name || null, phone: f.phone || null, policy_number: f.policy_number || null, category: f.category, summary: f.summary,
          owner_user_id: f.owner_user_id || null, about_agent_user_id: f.about_agent_user_id || null, partner_id: f.partner_id || null,
        }),
      });
      notify.done(f.category === "unwanted_calls" ? "Complaint recorded. The number is on your do-not-call list." : "Complaint recorded");
      if (body.evidence_warning) notify.warn(`Evidence report not attached: ${body.evidence_warning}`);
      setF(blank);
      router.push(`/app/complaints/${body.id}`);
      return true;
    } catch (err) {
      notify.block(err instanceof Error ? err.message : "That didn't save", { detail: "Nothing was changed." });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };
  return (
    <form ref={scope} onSubmit={submit} className={cn(cardSurface, "flex flex-col gap-4 p-5")}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Made to" htmlFor="cmp-channel"><select id="cmp-channel" className={control} value={f.channel} onChange={(e) => set("channel", e.target.value)}>{COMPLAINT_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}</select></Field>
        {f.channel === "doi"
          ? <Field label="Which state's department" htmlFor="cmp-state" required><select id="cmp-state" className={control} required value={f.regulator_state} onChange={(e) => set("regulator_state", e.target.value)}><option value="">Choose…</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          : null}
        <Field label="Received on" htmlFor="cmp-received" hint="A regulator's deadline counts from this day."><input id="cmp-received" type="date" className={control} max={new Date().toISOString().slice(0, 10)} value={f.received_at} onChange={(e) => set("received_at", e.target.value)} /></Field>
        <Field label="Arrived by" htmlFor="cmp-via"><select id="cmp-via" className={control} value={f.received_via} onChange={(e) => set("received_via", e.target.value)}>{COMPLAINT_VIA.map((v) => <option key={v} value={v}>{VIA_LABELS[v]}</option>)}</select></Field>
        <Field label="About" htmlFor="cmp-category" hint={f.category === "unwanted_calls" ? "Puts the number on your do-not-call list at once." : undefined}><select id="cmp-category" className={control} value={f.category} onChange={(e) => set("category", e.target.value)}>{COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></Field>
        <Field label="Phone number" htmlFor="cmp-phone" required={f.category === "unwanted_calls"}><input id="cmp-phone" className={control} inputMode="tel" maxLength={40} value={f.phone} required={f.category === "unwanted_calls"} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Complainant" htmlFor="cmp-name"><input id="cmp-name" className={control} maxLength={200} value={f.complainant_name} onChange={(e) => set("complainant_name", e.target.value)} /></Field>
        <Field label="Policy number" htmlFor="cmp-policy"><input id="cmp-policy" className={control} maxLength={120} value={f.policy_number} onChange={(e) => set("policy_number", e.target.value)} /></Field>
        <Field label="Owner" htmlFor="cmp-owner"><select id="cmp-owner" className={control} value={f.owner_user_id} onChange={(e) => set("owner_user_id", e.target.value)}><option value="">The agency owner</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="About which agent" htmlFor="cmp-agent"><select id="cmp-agent" className={control} value={f.about_agent_user_id} onChange={(e) => set("about_agent_user_id", e.target.value)}><option value="">Not about one agent</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Partner who sent the lead" htmlFor="cmp-partner"><select id="cmp-partner" className={control} value={f.partner_id} onChange={(e) => set("partner_id", e.target.value)}><option value="">Find it from the number</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      </div>
      <Field label="What the complaint says" htmlFor="cmp-summary" required><textarea id="cmp-summary" className={cn(textareaControl, "min-h-28")} required maxLength={4000} value={f.summary} onChange={(e) => set("summary", e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <DismissButton href="/app/complaints">Discard</DismissButton>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record complaint"}</Button>
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(blank)} what="this complaint" />
    </form>
  );
}

/* ── /app/complaints/[id] ──────────────────────────────────────────────── */

export type ComplaintTab = "complaint" | "response" | "files";

/**
 * The record's body and its header buttons (portalled to the title line, after the page's ‹ ›): the next thing
 * to do as the primary ("Write the response" until one is sent, then "Record the outcome", both on the Response
 * tab) and More (the number's evidence report, setting a regulator's response days). Save is the Response tab's
 * own form foot (r7 4·1, 2026-11-11), not the title line.
 */
export function ComplaintRecord({ complaint, checklist, respondent, team, tab, isOwner, readOnly }: { complaint: ComplaintRow; checklist: { key: string; item: string }[]; respondent: Respondent | null; team: Person[]; tab: ComplaintTab; isOwner: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [c, setC] = useState(complaint);
  const initial = (row: ComplaintRow) => ({ status: row.status, outcome: row.outcome ?? "", owner: row.owner.id, response: row.responseText ?? "", notes: row.notes ?? "" });
  const [saved, setSaved] = useState(() => initial(complaint));
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [settingDays, setSettingDays] = useState(false);
  const [days, setDays] = useState("");
  const scope = useRef<HTMLDivElement>(null);
  const dirty = (Object.keys(draft) as (keyof typeof draft)[]).some((k) => draft[k] !== saved[k]);

  const run = async (fn: () => Promise<{ complaint: ComplaintRow }>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      const next = (await fn()).complaint;
      setC(next);
      notify.done(done);
      router.refresh();
      return true;
    } catch (err) {
      notify.block(err instanceof Error ? err.message : "That didn't save", { detail: "Nothing was changed." });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>, done: string) => run(() => send(`/api/app/compliance/complaints/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), done);
  const save = async () => {
    const ok = await patch({ status: draft.status, outcome: draft.outcome || null, owner_user_id: draft.owner, response_text: draft.response || null, notes: draft.notes || null }, "Complaint saved");
    if (ok) setSaved(draft);
    return ok;
  };
  const upload = (file: File, side: "complaint" | "response") => {
    const form = new FormData();
    form.set("file", file);
    form.set("side", side);
    return run(() => send(`/api/app/compliance/complaints/${c.id}/attachments`, { method: "POST", body: form }), "File attached");
  };
  const setDeadline = async () => {
    const ok = await run(() => send(`/api/app/compliance/complaints/${c.id}/deadline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_days: Number(days) }) }), "Deadline set");
    if (ok) setSettingDays(false);
  };
  const regulatorName = c.channel === "ftc" ? "the FTC" : `the ${c.regulatorState ?? "state"} insurance department`;
  // The next thing, on the Response tab: write it until one is sent, then record how it ended.
  const responseHref = `/app/complaints/${c.id}?tab=response`;
  const next = readOnly || tab === "response" || c.status === "resolved" ? null : c.respondedAt ? "Record the outcome" : "Write the response";

  const files = (list: ComplaintRow["attachments"], side: "complaint" | "response", title: string) => (
    <TableCard title={title} action={!readOnly ? (
      <label className="inline-flex">
        <span className="sr-only">Attach a file to {title.toLowerCase()}</span>
        <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt,.eml,.docx" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, side); e.target.value = ""; }} />
        <span aria-hidden="true" className="inline-flex h-9 cursor-pointer items-center rounded-[8px] border border-[var(--border-strong)] px-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-alt)]">Attach a file</span>
      </label>
    ) : undefined}>
      {list.length === 0 ? <EmptyState title="Nothing attached yet" hint={side === "complaint" ? "The letter, the carrier notice, the email." : "What you sent back."} /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>File</th><th>Added</th><th>What it holds</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={`${a.name}-${a.addedAt}`}>
                <td>{a.kind === "evidence_report"
                  ? <Link className="text-[var(--accent-ink)] hover:underline" href={a.link ?? "#"}>{a.name}</Link>
                  : <a className="text-[var(--accent-ink)] hover:underline" href={`/api/app/compliance/complaints/${c.id}/attachments?path=${encodeURIComponent(a.path ?? "")}`}>{a.name}</a>}</td>
                <td className="whitespace-nowrap tabular-nums">{day(a.addedAt ?? null)}</td>
                <td className="text-muted-foreground">{a.kind === "evidence_report" ? `Evidence report · ${a.gaps} gap${a.gaps === 1 ? "" : "s"}, ${a.records} record${a.records === 1 ? "" : "s"}` : "Attached file"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );

  return (
    <div ref={scope} className="contents">
      <ComplianceSlot slot="corner">
        {next ? <Button asChild><Link href={responseHref}>{next}</Link></Button> : null}
        <MoreMenu items={[
          c.phoneDigits ? { label: "Evidence report for this number", href: `/app/evidence-report?phone=${c.phoneDigits}` } : null,
          c.countdown.tone === "no_deadline" && isOwner && !readOnly ? { label: "Set the response days", onSelect: () => setSettingDays(true) } : null,
          isOwner ? { label: "Deadlines in Compliance settings", href: "/app/compliance/settings#deadlines" } : null,
        ]} />
      </ComplianceSlot>
      {/* No notice on the page (r7): a regulator with no days is the Deadline tile's chip and More's "Set the
          response days"; what the response still needs is a line on the Response tab; a failure is a toast. */}

      {tab === "complaint" ? (
        <>
          <TableCard title="What the complaint says">
            <p className="m-0 border-t border-border px-4 py-3 text-sm whitespace-pre-wrap text-[var(--ink)]">{c.summary}</p>
          </TableCard>
          {checklist.length ? (
            <TableCard title="What a response needs" description="The platform's checklist for this kind of complaint. Ticks save at once.">
              <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">
                {checklist.map((item) => (
                  <li key={item.key} className="m-row px-4 py-2.5">
                    <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
                      <input type="checkbox" className={cn(checkboxControl, "mt-0.5")} disabled={readOnly || busy} checked={Boolean(c.checklist[item.key])} onChange={(e) => void patch({ checklist: { ...c.checklist, [item.key]: e.target.checked } }, "Checklist saved")} />
                      <span>{item.item}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </TableCard>
          ) : <TableCard><EmptyState title="No checklist for this kind of complaint" hint="The response is yours to write on the Response tab." /></TableCard>}
        </>
      ) : tab === "response" ? (
        <div className={cn(cardSurface, "flex flex-col gap-4 p-5")}>
          {respondent && !respondent.missing ? (
            <p className="m-0 text-sm text-muted-foreground">Responding as <span className="text-[var(--ink)]">{respondent.legalName}</span> · NPN {respondent.npn} · {respondent.licence ? `${respondent.licence.state} licence ${respondent.licence.number}` : `no ${c.regulatorState ?? "state"} licence on file`}</p>
          ) : respondent?.missing ? (
            <p className="m-0 text-sm text-[var(--ink)]">{respondent.missing}{respondent.fixHref ? <> <Link className="text-[var(--accent-ink)] hover:underline" href={respondent.fixHref}>Open Business identity ›</Link></> : null}</p>
          ) : null}
          <Field label="Your response" htmlFor="cmp-response" hint={<>Written and signed by you; nothing here drafts it.{c.respondedAt ? ` Sent ${day(c.respondedAt)}.` : ""}</>}>
            <textarea id="cmp-response" className={cn(textareaControl, "min-h-48")} disabled={readOnly} maxLength={20000} value={draft.response} onChange={(e) => setDraft((d) => ({ ...d, response: e.target.value }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status" htmlFor="cmp-status"><select id="cmp-status" className={control} disabled={readOnly} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>{COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></Field>
            <Field label="Outcome" htmlFor="cmp-outcome"><select id="cmp-outcome" className={control} disabled={readOnly} value={draft.outcome} onChange={(e) => setDraft((d) => ({ ...d, outcome: e.target.value }))}><option value="">Not yet</option>{COMPLAINT_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}</select></Field>
            <Field label="Owner" htmlFor="cmp-owner-edit"><select id="cmp-owner-edit" className={control} disabled={readOnly} value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))}>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          </div>
          <Field label="Notes" htmlFor="cmp-notes"><textarea id="cmp-notes" className={textareaControl} disabled={readOnly} maxLength={4000} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} /></Field>
          {!readOnly ? (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => setDraft(saved)}>Discard</Button>
              <Button type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save response"}</Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {files(c.attachments, "complaint", "What arrived")}
          {files(c.responseAttachments, "response", "What we sent")}
        </>
      )}
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setDraft(saved)} what="this complaint" />
      <ConfirmDialog
        open={settingDays}
        onOpenChange={setSettingDays}
        onConfirm={() => void setDeadline()}
        busy={busy}
        destructive={false}
        title="Set the response days"
        description={`How many days ${regulatorName} allows for a response. Saved for this regulator and applied to this complaint.`}
        confirmLabel="Set days"
        confirmDisabled={!days || Number(days) < 1 || Number(days) > 180}
        fields={<Field label="Response days" htmlFor="cmp-days" required><input id="cmp-days" type="number" min={1} max={180} className={control} value={days} onChange={(e) => setDays(e.target.value)} /></Field>}
      />
    </div>
  );
}
