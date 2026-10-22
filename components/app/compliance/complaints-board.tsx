"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
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
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { notify } from "@/lib/notify";

/**
 * LA-6.4 · the complaint list: days remaining first, amber at 10, red at 5, overdue loudest. Opening
 * a row shows the record, the response checklist, the attached evidence report and the agent's own
 * response — typed by the agent; nothing here drafts it.
 */
type Person = { id: string; name: string; role: string };
type Coverage = { licensed: number; covered: number; missing: string[]; ftc: boolean; sentence: string };

const TONE: Record<CountdownTone, StatusTone> = { overdue: "danger", red: "danger", amber: "warning", no_deadline: "warning", calm: "neutral", none: "neutral" };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

function NewComplaint({ team, partners, onClose, onSaved }: { team: Person[]; partners: Person[] | { id: string; name: string }[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ channel: "agent" as ComplaintChannel, regulator_state: "", received_at: new Date().toISOString().slice(0, 10), received_via: "phone", complainant_name: "", phone: "", policy_number: "", category: "unwanted_calls" as ComplaintCategory, summary: "", owner_user_id: "", about_agent_user_id: "", partner_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
      onSaved(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const field = "flex flex-col gap-1 text-sm";
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[620px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Record a complaint</DialogTitle>
            <DialogDescription>A complaint about unwanted calls puts the number on your do-not-call list at once.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>Made to<select className={toolbarControl} value={f.channel} onChange={(e) => set("channel", e.target.value)}>{COMPLAINT_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}</select></label>
            {f.channel === "doi" ? <label className={field}>Which state&apos;s department<select className={toolbarControl} required value={f.regulator_state} onChange={(e) => set("regulator_state", e.target.value)}><option value="">Choose…</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label> : <span />}
            <label className={field}>Received on<input type="date" className={toolbarControl} max={new Date().toISOString().slice(0, 10)} value={f.received_at} onChange={(e) => set("received_at", e.target.value)} /></label>
            <label className={field}>Arrived by<select className={toolbarControl} value={f.received_via} onChange={(e) => set("received_via", e.target.value)}>{COMPLAINT_VIA.map((v) => <option key={v} value={v}>{VIA_LABELS[v]}</option>)}</select></label>
            <label className={field}>About<select className={toolbarControl} value={f.category} onChange={(e) => set("category", e.target.value)}>{COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></label>
            <label className={field}>Phone number{f.category === "unwanted_calls" ? " (required)" : ""}<input className={toolbarControl} inputMode="tel" maxLength={40} value={f.phone} required={f.category === "unwanted_calls"} onChange={(e) => set("phone", e.target.value)} /></label>
            <label className={field}>Complainant<input className={toolbarControl} maxLength={200} value={f.complainant_name} onChange={(e) => set("complainant_name", e.target.value)} /></label>
            <label className={field}>Policy number<input className={toolbarControl} maxLength={120} value={f.policy_number} onChange={(e) => set("policy_number", e.target.value)} /></label>
            <label className={field}>Owner<select className={toolbarControl} value={f.owner_user_id} onChange={(e) => set("owner_user_id", e.target.value)}><option value="">The agency owner</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className={field}>About which agent<select className={toolbarControl} value={f.about_agent_user_id} onChange={(e) => set("about_agent_user_id", e.target.value)}><option value="">Not about one agent</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className={field}>Partner who sent the lead<select className={toolbarControl} value={f.partner_id} onChange={(e) => set("partner_id", e.target.value)}><option value="">Find it from the number</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <label className={field}>What the complaint says<textarea className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm" required maxLength={4000} value={f.summary} onChange={(e) => set("summary", e.target.value)} /></label>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record complaint"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ComplaintPanel({ id, team, isOwner, readOnly, onClose, onChanged }: { id: string; team: Person[]; isOwner: boolean; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const [c, setC] = useState<ComplaintRow | null>(null);
  const [checklist, setChecklist] = useState<{ key: string; item: string }[]>([]);
  const [respondent, setRespondent] = useState<Respondent | null>(null);
  const [draft, setDraft] = useState({ status: "", outcome: "", owner: "", response: "", notes: "" });
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = (row: ComplaintRow) => {
    setC(row);
    setDraft({ status: row.status, outcome: row.outcome ?? "", owner: row.owner.id, response: row.responseText ?? "", notes: row.notes ?? "" });
  };
  useEffect(() => {
    let live = true;
    fetch(`/api/app/compliance/complaints/${id}`).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Could not open the complaint");
      else { load(body.complaint); setChecklist(body.checklist ?? []); setRespondent(body.respondent ?? null); }
    });
    return () => { live = false; };
  }, [id]);
  const run = async (fn: () => Promise<{ complaint: ComplaintRow }>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      load((await fn()).complaint);
      notify.done(done);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>, done: string) => run(() => send(`/api/app/compliance/complaints/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), done);
  const upload = (file: File, side: "complaint" | "response") => {
    const form = new FormData();
    form.set("file", file);
    form.set("side", side);
    return run(() => send(`/api/app/compliance/complaints/${id}/attachments`, { method: "POST", body: form }), "File attached");
  };
  const files = (list: ComplaintRow["attachments"], side: "complaint" | "response") => (
    <div className="flex flex-col gap-1 text-sm">
      {list.length === 0 ? <span className="text-muted-foreground">None yet.</span> : null}
      {list.map((a) => (
        <div key={`${a.name}-${a.addedAt}`}>
          {a.kind === "evidence_report" ? (
            <a className="underline" href={a.link}>{a.name}</a>
          ) : (
            <a className="underline" href={`/api/app/compliance/complaints/${id}/attachments?path=${encodeURIComponent(a.path ?? "")}`}>{a.name}</a>
          )}
          {a.kind === "evidence_report" ? <span className="text-xs text-muted-foreground"> · {a.gaps} gap{a.gaps === 1 ? "" : "s"}, {a.records} records</span> : null}
        </div>
      ))}
      {!readOnly ? <label className="text-xs text-muted-foreground">Attach a file<input type="file" className="mt-1 block text-xs" accept=".pdf,.png,.jpg,.jpeg,.txt,.eml,.docx" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, side); e.target.value = ""; }} /></label> : null}
    </div>
  );
  const section = "flex flex-col gap-2 border-t border-border pt-4";
  return (
    <DetailPanel
      mode="overlay"
      title={c ? `${CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category} complaint` : "Complaint"}
      subtitle={c ? `${CHANNEL_LABELS[c.channel as ComplaintChannel] ?? c.channel}${c.regulatorState ? ` · ${c.regulatorState}` : ""} · received ${day(c.receivedAt)}` : undefined}
      status={c ? <StatusChip tone={TONE[c.countdown.tone]}>{c.countdown.label}</StatusChip> : undefined}
      onClose={onClose}
      footer={c && !readOnly ? <Button disabled={busy} onClick={() => void patch({ status: draft.status, outcome: draft.outcome || null, owner_user_id: draft.owner, response_text: draft.response || null, notes: draft.notes || null }, "Complaint saved")}>Save</Button> : undefined}
    >
      {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
      {!c ? null : (
        <>
          {c.countdown.tone === "no_deadline" ? (
            <div role="alert" className="flex flex-col gap-2 rounded-lg border border-[var(--warning)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-ink)]">
              <span>No response deadline is set for the {c.channel === "ftc" ? "FTC" : `${c.regulatorState ?? "state"} insurance department`}. Look up the statutory days and set them — no default is assumed.</span>
              {isOwner && !readOnly ? (
                <span className="flex items-center gap-2">
                  <input type="number" min={1} max={180} className={`${toolbarControl} w-24`} aria-label="Response days" value={days} onChange={(e) => setDays(e.target.value)} />
                  <Button variant="outline" disabled={busy || !days} onClick={() => void run(() => send(`/api/app/compliance/complaints/${id}/deadline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_days: Number(days) }) }), "Deadline set")}>Set days</Button>
                </span>
              ) : <span>Ask the agency owner to set it.</span>}
            </div>
          ) : null}
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Complainant</dt><dd>{c.complainantName ?? "—"}</dd>
            <dt className="text-muted-foreground">Number</dt><dd>{c.phoneDigits ? <Link className="underline" href={`/app/evidence-report?phone=${c.phoneDigits}`}>{formatPhone(c.phoneDigits)}</Link> : "—"}</dd>
            <dt className="text-muted-foreground">Policy</dt><dd>{c.policyNumber ?? "—"}</dd>
            <dt className="text-muted-foreground">About agent</dt><dd>{c.aboutAgent?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Partner</dt><dd>{c.partner?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Respond by</dt><dd>{day(c.responseDueAt)}</dd>
            {c.dncAddedAt ? (<><dt className="text-muted-foreground">Do-not-call</dt><dd>Added {day(c.dncAddedAt)}, caused by this complaint</dd></>) : null}
          </dl>
          <p className="whitespace-pre-wrap text-sm">{c.summary}</p>
          <div className={section}><span className="text-sm font-semibold">What arrived</span>{files(c.attachments, "complaint")}</div>
          {checklist.length ? (
            <div className={section}>
              <span className="text-sm font-semibold">What a response needs</span>
              {checklist.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" disabled={readOnly || busy} checked={Boolean(c.checklist[item.key])} onChange={(e) => void patch({ checklist: { ...c.checklist, [item.key]: e.target.checked } }, "Checklist saved")} />
                  <span>{item.item}</span>
                </label>
              ))}
            </div>
          ) : null}
          {respondent ? (
            <div className={section}>
              <span className="text-sm font-semibold">Responding as</span>
              {respondent.missing ? (
                <p className="m-0 text-sm text-[var(--warning-ink)]">{respondent.missing} {respondent.fixHref ? <Link className="underline" href={respondent.fixHref}>Open Business identity</Link> : null}</p>
              ) : (
                <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Legal name</dt><dd>{respondent.legalName}</dd>
                  <dt className="text-muted-foreground">NPN</dt><dd>{respondent.npn}</dd>
                  <dt className="text-muted-foreground">Licence</dt><dd>{respondent.licence ? `${respondent.licence.state} ${respondent.licence.number}` : `No ${c.regulatorState ?? "state"} licence on file`}</dd>
                </dl>
              )}
            </div>
          ) : null}
          <div className={section}>
            <span className="text-sm font-semibold">Your response</span>
            <textarea className="min-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={readOnly} maxLength={20000} value={draft.response} onChange={(e) => setDraft((d) => ({ ...d, response: e.target.value }))} aria-label="Response text" />
            <span className="text-xs text-muted-foreground">Written and signed by you. {c.respondedAt ? `Sent ${day(c.respondedAt)}.` : ""}</span>
            {files(c.responseAttachments, "response")}
          </div>
          <div className={`${section} grid grid-cols-2 gap-3`}>
            <label className="flex flex-col gap-1 text-sm">Status<select className={toolbarControl} disabled={readOnly} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>{COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm">Outcome<select className={toolbarControl} disabled={readOnly} value={draft.outcome} onChange={(e) => setDraft((d) => ({ ...d, outcome: e.target.value }))}><option value="">Not yet</option>{COMPLAINT_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}</select></label>
            <label className="col-span-2 flex flex-col gap-1 text-sm">Owner<select className={toolbarControl} disabled={readOnly} value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))}>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="col-span-2 flex flex-col gap-1 text-sm">Notes<textarea className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={readOnly} maxLength={4000} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} /></label>
          </div>
        </>
      )}
    </DetailPanel>
  );
}

export function ComplaintsBoard({ complaints, coverage, thresholds, search, openId, team, partners, isOwner, readOnly }: { complaints: ComplaintRow[]; coverage: Coverage; thresholds: Thresholds; search: string; openId: string | null; team: Person[]; partners: { id: string; name: string }[]; isOwner: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(search);
  const [view, setView] = useState<"open" | "all">("open");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(openId);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const visible = useMemo(() => complaints.filter((c) => view === "all" || c.status !== "resolved"), [complaints, view]);
  const shown = paginate(visible, page, 15);
  const open5 = complaints.filter((c) => c.countdown.pinned).length;
  const regulator = complaints.filter((c) => (c.channel === "doi" || c.channel === "ftc") && c.status !== "resolved").length;
  const noDeadline = complaints.filter((c) => c.countdown.tone === "no_deadline").length;

  useEffect(() => {
    const t = setTimeout(() => { if (q !== search) router.replace(q.trim() ? `/app/complaints?q=${encodeURIComponent(q.trim())}` : "/app/complaints"); }, 350);
    return () => clearTimeout(t);
  }, [q, search, router]);

  return (
    <>
      <StatStrip label="Complaint totals">
        <StatTile label="Open" value={String(complaints.filter((c) => c.status !== "resolved").length)} footnote={`${complaints.length} on record`} />
        <StatTile label="Regulator" value={String(regulator)} footnote="DOI and FTC, open" />
        <StatTile label={`Due within ${thresholds.redDays} days`} value={String(open5)} valueTone={open5 ? "danger" : undefined} footnote="or overdue" />
        <StatTile label="No deadline set" value={String(noDeadline)} valueTone={noDeadline ? "warning" : undefined} footnote="regulator complaints" />
      </StatStrip>
      {coverage.missing.length ? <p role="alert" className="rounded-lg border border-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{coverage.sentence}</p> : null}
      <TableCard
        toolbar={
          <DataToolbar actions={<>{!readOnly ? <Button onClick={() => setCreating(true)}>Record a complaint</Button> : null}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
            <ToolbarSearch value={q} onChange={setQ} placeholder="Search complaints and responses" />
            <select aria-label="Which complaints" className={toolbarControl} value={view} onChange={(e) => { setView(e.target.value as "open" | "all"); setPage(1); }}>
              <option value="open">Not resolved</option>
              <option value="all">All</option>
            </select>
          </DataToolbar>
        }
        footer={visible.length > 15 ? <Pager page={shown.current} pageSize={15} total={visible.length} noun="complaints" onPage={setPage} /> : undefined}
      >
        {complaints.length === 0 && !search ? (
          <EmptyState title="No complaints recorded" hint="Record one the day it arrives: a regulator's deadline starts counting then." action={!readOnly ? <Button onClick={() => setCreating(true)}>Record a complaint</Button> : undefined} />
        ) : visible.length === 0 ? (
          <NoMatches noun="complaints" onClear={() => { setQ(""); setView("all"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead><tr><th className="w-[210px]">Deadline</th><th className="w-[110px]">Received</th><th>Complaint</th><th className="w-[170px]">Owner</th><th className="w-[140px]">Status</th><th className="w-[90px] text-right" /></tr></thead>
            <tbody>
              {shown.rows.map((c) => (
                <tr key={c.id} className={c.countdown.tone === "overdue" ? "bg-[var(--error-surface)]" : undefined}>
                  <td><StatusChip tone={TONE[c.countdown.tone]}>{c.countdown.label}</StatusChip>{c.responseDueAt ? <div className="text-xs text-muted-foreground">by {day(c.responseDueAt)}</div> : null}</td>
                  <td>{day(c.receivedAt)}</td>
                  <td><div className="font-medium">{CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category} · {CHANNEL_LABELS[c.channel as ComplaintChannel] ?? c.channel}{c.regulatorState ? ` (${c.regulatorState})` : ""}</div><div className="text-xs text-muted-foreground">{[c.complainantName, c.phoneDigits ? formatPhone(c.phoneDigits) : null, c.partner ? `via ${c.partner.name}` : null].filter(Boolean).join(" · ") || "—"}</div></td>
                  <td>{c.owner.name}</td>
                  <td>{STATUS_LABELS[c.status as keyof typeof STATUS_LABELS] ?? c.status}</td>
                  <td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(c.id)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {creating ? <NewComplaint team={team} partners={partners} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setOpen(id); refresh(); }} /> : null}
      {open ? <ComplaintPanel key={open} id={open} team={team} isOwner={isOwner} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={refresh} /> : null}
    </>
  );
}
