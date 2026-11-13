"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ageDays, ageLabel, ageTone, OWNER_ROLE_LABELS, OWNER_ROLES, QUEUE_LABELS, QUEUE_TYPES, RESOLUTION_LABELS, RESOLUTIONS, type OwnerRole, type QueueRule, type QueueType, type Resolution } from "@/lib/ingestion/exceptionQueues";
import type { QueueItemRow } from "@/lib/ingestion/exceptionQueuesStore";
import { fileDay } from "@/lib/ingestion/constants";
import { notify } from "@/lib/notify";

export type ExceptionsTab = "open" | "closed" | "owners";
/** The one chip on an open row (owner 2026-11-11): its age's tone, said in words, never a coloured number. */
const AGE_CHIP = { fresh: { tone: "neutral", text: "Open" }, aging: { tone: "warning", text: "Aging" }, escalated: { tone: "danger", text: "Escalated" } } as const;
/** A row's action: a short verb and ›, plain, the same weight on every row (owner 2026-11-11). */
const ROW_ACTION = "whitespace-nowrap text-sm text-foreground hover:underline";
const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toFixed(2)}`);

/** `plain`: in a table row, "(provisional)" in words, since the row's one chip is its state (owner 2026-11-11). */
function Client({ person, plain = false }: { person: { name: string; provisional: boolean } | null; plain?: boolean }) {
  if (!person) return <span className="text-muted-foreground">—</span>;
  if (plain) return <>{person.name}{person.provisional ? " (provisional)" : ""}</>;
  return <span className="inline-flex flex-wrap items-center gap-1.5">{person.name}{person.provisional && <ProvisionalBadge />}</span>;
}

/** The whole account of an existing book's import, for the dialog and the row's tooltip. */
function importSentence(item: QueueItemRow) {
  const p = item.payload ?? {};
  return `${item.carrierName ?? p.carrier_name} · ${Number(p.policies ?? 0).toLocaleString("en-US")} policies imported, ${Number(p.provisional ?? 0).toLocaleString("en-US")} provisional clients created${Number(p.existing ?? 0) ? `, ${Number(p.existing).toLocaleString("en-US")} matched to clients on file` : ""}${Number(p.blocked ?? 0) ? `, ${Number(p.blocked).toLocaleString("en-US")} without a client` : ""}`;
}

/** What the item is about, in one line. `plain`: a table cell's one line, one colour, no badge. */
function subject(item: QueueItemRow, plain = false) {
  if (item.queueType === "no_policy") return <span>{item.deal?.insuredName ?? "—"} · {item.carrierName ?? item.deal?.carrier ?? "—"} · {dollars(item.deal?.premiumCents)} a month</span>;
  if (item.queueType === "initial_import") {
    const p = item.payload ?? {};
    if (plain) return <span title={importSentence(item)}>{item.carrierName ?? p.carrier_name} · {Number(p.policies ?? 0).toLocaleString("en-US")} policies imported</span>;
    return <span>{importSentence(item)}</span>;
  }
  if (item.queueType === "orphan_commission") {
    const p = item.payload ?? {};
    const cents = Number(p.amount_cents ?? 0);
    return <span><span className={plain ? "tabular-nums" : "font-medium tabular-nums"}>{item.policyNumber}</span> · {item.carrierName ?? "—"} · {Number(p.lines ?? 0).toLocaleString("en-US")} commission {Number(p.lines ?? 0) === 1 ? "line" : "lines"}, {cents < 0 ? "−" : ""}{dollars(Math.abs(cents))}, since {String(p.first_seen ?? "")}</span>;
  }
  if (item.queueType === "multi_policy") return plain ? <span><Client person={item.contact} plain /> and <Client person={item.related} plain /></span> : <span className="inline-flex flex-wrap items-center gap-1"><Client person={item.contact} /> and <Client person={item.related} /></span>;
  if (plain) return <span><span className="tabular-nums">{item.policyNumber}</span> · {item.carrierName} · <Client person={item.contact} plain /></span>;
  return <span className="inline-flex flex-wrap items-center gap-1.5"><span className="font-medium tabular-nums">{item.policyNumber}</span> · {item.carrierName} · <Client person={item.contact} /></span>;
}

/**
 * LA-4.9 (Notion sprint) · every exception queue through one component: grouped by queue, oldest
 * first, each item with what it is, why it is here, its age, its owner and the actions that close it.
 */
export function ExceptionQueues({ open, closed, rules, isOwner, today, readOnly, carriers, tab = "open" }: { open: QueueItemRow[]; closed: QueueItemRow[]; rules: Record<QueueType, QueueRule>; isOwner: boolean; today: string; readOnly: boolean; carriers: Array<{ id: string; name: string }>; /** The view the page's title-line tabs chose (?tab=). */ tab?: ExceptionsTab }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [current, setCurrent] = useState<QueueItemRow | null>(null);
  const [choice, setChoice] = useState<Resolution | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<Record<QueueType, QueueRule>>(rules);
  const [openPage, setOpenPage] = useState<Partial<Record<QueueType, number>>>({});
  const [closedPage, setClosedPage] = useState(1);
  const closedShown = paginate(closed, closedPage, 10);

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/app/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      setCurrent(null);
      setChoice(null);
      setFields({});
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (!current || !choice) return;
    const base = { action: "resolve", item_id: current.id, resolution: choice };
    const extra = choice === "link_existing_client" ? { contact_id: fields.contact } : choice === "found_the_sale" ? { deal_id: fields.deal }
      : choice === "found_the_policy" ? { carrier_id: fields.carrier || current.carrierId, policy_number: fields.policy } : choice === "never_submitted" ? { reason: fields.reason ?? "" }
      : choice === "resubmitted_elsewhere" ? { application_id: fields.application }
      : choice === "another_writing_number" ? (fields.note?.trim() ? { note: fields.note.trim() } : {}) : choice === "raised_with_carrier" ? { note: (fields.note ?? "").trim() } : {};
    void post({ ...base, ...extra }, choice === "not_mine" ? "Handed on." : "Closed.");
  }

  const needs = (r: Resolution | null) => r === "link_existing_client" ? !fields.contact : r === "found_the_sale" ? !fields.deal : r === "found_the_policy" ? !fields.policy : r === "never_submitted" ? !(fields.reason ?? "").trim() : r === "resubmitted_elsewhere" ? !fields.application : r === "raised_with_carrier" ? !(fields.note ?? "").trim() : false;
  const toolbar = <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}><span className="text-sm text-foreground">Oldest first</span></DataToolbar>;

  return (
    <>
      {/* The tabs are on the title line (the page's `lead`); this is the panel they switch. */}
      <div id="exceptions-panel" role="tabpanel" aria-labelledby={`exceptions-panel-tab-${tab}`} className="flex min-w-0 flex-col gap-6">

      {tab === "open" && (open.length === 0 ? (
        <TableCard toolbar={toolbar}><EmptyState title="Nothing open" hint="Policies with no sale, sales no carrier has heard of, and possible duplicate clients appear here." /></TableCard>
      ) : QUEUE_TYPES.filter((type) => open.some((item) => item.queueType === type)).map((type, index) => {
        const items = open.filter((item) => item.queueType === type).sort((a, b) => a.ageFrom.localeCompare(b.ageFrom));
        if (!items.length) return null;
        const shown = paginate(items, openPage[type] ?? 1, 10);
        return (
          <TableCard key={type} toolbar={index === 0 ? toolbar : undefined} footer={items.length > 10 ? <Pager page={shown.current} pageSize={10} total={items.length} noun="items" onPage={(to) => setOpenPage((all) => ({ ...all, [type]: to }))} /> : undefined}>
            <div className="border-b border-border px-4 py-3">
              <h2 className="m-0 text-sm font-semibold text-foreground">{QUEUE_LABELS[type].title} <span className="text-muted-foreground">· {items.length}</span></h2>
              <p className="m-0 mt-0.5 text-xs text-muted-foreground">{QUEUE_LABELS[type].why}</p>
            </div>
            <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
              {/* Owner 2026-11-11: one line per row, the subject first; the age is a plain period and its tone the row's one chip; the owner's role is the name's tooltip. */}
              <thead><tr><th>What</th><th>Owner</th><th title="From the sale's date for unsubmitted sales, otherwise from when the item appeared">Age</th><th>Status</th><th>Next step</th></tr></thead>
              <tbody>
                {shown.rows.map((item) => {
                  const age = ageDays(item.ageFrom, today);
                  const chip = AGE_CHIP[ageTone(age, rules[type], item.escalated)];
                  const openIt = () => { setCurrent(item); setChoice(null); setFields({}); };
                  return (
                    <tr key={item.id} className="cursor-pointer" onClick={openIt}>
                      <td className="whitespace-nowrap font-medium text-foreground">{subject(item, true)}</td>
                      <td className="whitespace-nowrap" title={OWNER_ROLE_LABELS[item.assignedRole]}>{item.assigneeName}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{ageLabel(age)}</td>
                      <td><StatusChip tone={chip.tone}>{chip.text}</StatusChip></td>
                      <td><button type="button" className={ROW_ACTION} onClick={(event) => { event.stopPropagation(); openIt(); }}>{readOnly ? "Open" : "Resolve"} ›</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
        );
      }))}

      {tab === "closed" && (
        <TableCard toolbar={toolbar} footer={closed.length > 10 ? <Pager page={closedShown.current} pageSize={10} total={closed.length} noun="closed items" onPage={setClosedPage} /> : undefined}>
          {closed.length === 0 ? <EmptyState title="Nothing closed in the last 30 days" hint="Every resolution is recorded here with who closed it and how." /> : (
            <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
              <thead><tr><th>Queue</th><th>What</th><th>How</th><th>By</th><th className="w-[110px]">When</th></tr></thead>
              <tbody>
                {closedShown.rows.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap font-medium text-foreground">{QUEUE_LABELS[item.queueType].title}</td>
                    <td className="whitespace-nowrap">{subject(item, true)}</td>
                    {/* The resolution's note was a grey second line; it is the cell's tooltip now. */}
                    <td className="whitespace-nowrap" title={item.resolutionNote ?? undefined}>{item.resolution && item.resolution in RESOLUTION_LABELS ? RESOLUTION_LABELS[item.resolution as Resolution] : item.resolution === "auto_linked" ? "Answered by a policy link" : item.resolution}</td>
                    <td className="whitespace-nowrap">{item.resolvedByName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(item.resolvedAt?.slice(0, 10) ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {tab === "owners" && isOwner && (
        <TableCard toolbar={<DataToolbar><span className="text-sm text-foreground">A role with nobody in it falls back to you, so no item is ever unowned.</span></DataToolbar>}>
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead><tr><th>Queue</th><th className="w-[230px]">Owner</th><th className="w-[130px]">Raise after (days)</th><th className="w-[130px]">Escalate after (days)</th><th className="w-[230px]">Escalate to</th><th className="w-[90px] text-right"><span className="sr-only">Save</span></th></tr></thead>
            <tbody>
              {QUEUE_TYPES.map((type) => {
                const rule = ruleDraft[type];
                const set = (patch: Partial<QueueRule>) => setRuleDraft((all) => ({ ...all, [type]: { ...all[type], ...patch } }));
                const num = (value: string) => (value.trim() === "" ? null : Number(value.replace(/\D/g, "")));
                return (
                  <tr key={type}>
                    <td className="whitespace-nowrap font-medium text-foreground">{QUEUE_LABELS[type].title}</td>
                    <td><select aria-label={`Owner of ${QUEUE_LABELS[type].title}`} className={`${toolbarControl} w-full`} value={rule.ownerRole} onChange={(e) => set({ ownerRole: e.target.value as OwnerRole })}>{OWNER_ROLES.map((role) => <option key={role} value={role}>{OWNER_ROLE_LABELS[role]}</option>)}</select></td>
                    <td>{type === "no_policy" ? <Input aria-label="Raise after days" inputMode="numeric" value={rule.openAfterDays ?? ""} onChange={(e) => set({ openAfterDays: num(e.target.value) })} /> : <span className="whitespace-nowrap">at once</span>}</td>
                    <td><Input aria-label="Escalate after days" inputMode="numeric" value={rule.escalateAfterDays ?? ""} onChange={(e) => set({ escalateAfterDays: num(e.target.value) })} /></td>
                    <td><select aria-label="Escalate to" className={`${toolbarControl} w-full`} value={rule.escalateToRole ?? ""} onChange={(e) => set({ escalateToRole: (e.target.value || null) as OwnerRole | null })}><option value="">Show it as escalated</option>{OWNER_ROLES.map((role) => <option key={role} value={role}>{OWNER_ROLE_LABELS[role]}</option>)}</select></td>
                    <td className="text-right"><Button type="button" size="sm" disabled={busy || readOnly} onClick={() => void post({ action: "save_rule", queue_type: type, owner_role: rule.ownerRole, open_after_days: type === "no_policy" ? rule.openAfterDays : null, escalate_after_days: rule.escalateAfterDays, escalate_to_role: rule.escalateToRole }, "Saved.")}>Save</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      )}
      </div>

      <Dialog open={Boolean(current)} onOpenChange={(next) => { if (!next && !busy) setCurrent(null); }}>
        <DialogContent className="sm:max-w-xl">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{QUEUE_LABELS[current.queueType].title}</DialogTitle>
                <DialogDescription>{QUEUE_LABELS[current.queueType].why} Open {ageDays(current.ageFrom, today) === 0 ? "since today" : `for ${ageLabel(ageDays(current.ageFrom, today))}`} · owner {current.assigneeName}.</DialogDescription>
              </DialogHeader>
              <div className="text-sm">{subject(current)}</div>
              {current.queueType === "initial_import" && <Link href="/app/duplicates" className="text-sm font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline">Open the contact directory to check the provisional clients</Link>}
              {current.queueType === "no_deal_flow" && current.contact?.provisional && <p className="m-0 text-xs text-muted-foreground">The client was built from the carrier&apos;s file (name, date of birth, address) and nobody has checked it.</p>}
              <fieldset disabled={readOnly || busy} className="grid gap-2">
                {current.payload?.client_blocked && <Callout tone="warning" title={String(current.payload.client_blocked)} />}
                {RESOLUTIONS[current.queueType].filter((r) => r !== "confirm_client" || Boolean(current.contact)).map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" name="resolution" checked={choice === r} onChange={() => setChoice(r)} />{RESOLUTION_LABELS[r]}</label>
                ))}
                {choice === "link_existing_client" && (
                  <div className="grid gap-1"><Label htmlFor="q-contact">Client</Label><SelectMenu id="q-contact" label="Client" className="w-full" matchTriggerWidth panelAlign="start" searchPlaceholder="Search by name" value={fields.contact ?? ""} onChange={(v) => setFields({ ...fields, contact: v })} options={[{ value: "", label: "Choose a client with this surname", disabled: true }, ...(current.choices.contacts ?? []).map((c) => ({ value: c.id, label: c.name, description: c.dob ?? undefined }))]} /></div>
                )}
                {choice === "found_the_sale" && (
                  <div className="grid gap-1"><Label htmlFor="q-deal">Sale</Label><SelectMenu id="q-deal" label="Sale" className="w-full" matchTriggerWidth panelAlign="start" searchPlaceholder="Search by name" value={fields.deal ?? ""} onChange={(v) => setFields({ ...fields, deal: v })} options={[{ value: "", label: "Choose a recent sale", disabled: true }, ...(current.choices.deals ?? []).map((d) => ({ value: d.id, label: d.name, description: d.date }))]} /></div>
                )}
                {choice === "found_the_policy" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1"><Label htmlFor="q-carrier">Carrier</Label><SelectMenu id="q-carrier" label="Carrier" className="w-full" matchTriggerWidth panelAlign="start" searchPlaceholder="Search carriers" value={fields.carrier ?? current.carrierId ?? ""} onChange={(v) => setFields({ ...fields, carrier: v })} options={carriers.map((c) => ({ value: c.id, label: c.name }))} /></div>
                    <div className="grid gap-1"><Label htmlFor="q-policy">Policy number</Label><Input id="q-policy" list="q-policies" value={fields.policy ?? ""} onChange={(e) => setFields({ ...fields, policy: e.target.value })} /><datalist id="q-policies">{(current.choices.policies ?? []).map((p) => <option key={p.policyNumber} value={p.policyNumber}>{p.label}</option>)}</datalist></div>
                  </div>
                )}
                {(choice === "another_writing_number" || choice === "raised_with_carrier") && (
                  <div className="grid gap-1"><Label htmlFor="q-note">{choice === "raised_with_carrier" ? "What you asked the carrier" : "Note (optional)"}</Label><Input id="q-note" maxLength={2000} value={fields.note ?? ""} onChange={(e) => setFields({ ...fields, note: e.target.value })} /></div>
                )}
                {choice === "never_submitted" && (
                  <div className="grid gap-1"><Label htmlFor="q-reason">Why</Label><Input id="q-reason" maxLength={2000} value={fields.reason ?? ""} onChange={(e) => setFields({ ...fields, reason: e.target.value })} /><span className="text-xs text-muted-foreground">The sale&apos;s open application case is closed as abandoned, so the campaign funnel stops counting it as applied.</span></div>
                )}
                {choice === "resubmitted_elsewhere" && (
                  <div className="grid gap-1"><Label htmlFor="q-app">Attempt</Label><SelectMenu id="q-app" label="Attempt" className="w-full" matchTriggerWidth panelAlign="start" value={fields.application ?? ""} onChange={(v) => setFields({ ...fields, application: v })} options={[{ value: "", label: "Choose the attempt", disabled: true }, ...(current.choices.applications ?? []).map((a) => ({ value: a.id, label: a.label }))]} /></div>
                )}
              </fieldset>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setCurrent(null)}>Close</Button>
                {!readOnly && <Button type="button" disabled={busy || !choice || needs(choice)} onClick={submit}>Save</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
