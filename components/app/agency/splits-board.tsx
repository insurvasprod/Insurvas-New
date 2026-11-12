"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { StepSlot } from "@/components/app/step-frame/step-slot";
import { SPLITS_SLOT } from "@/components/app/commissions/splits/slots";
import { usDate, WIDE_DIALOG } from "@/components/app/commissions/team-payouts/shared";
import { bpsToPercent, dollars, dollarsToCents, percentToBps } from "@/lib/agency/constants";
import { computeOverride, splitPool } from "@/lib/agency/overrideCore";
import { sendJson, useAgencyData } from "./use-agency-data";

/**
 * AG-1.6 · Commissions › Commission splits (round 7, owner pick 8·A, 2026-11-10; docs/la4/mockups-r7/commissions.html).
 * Policies two producers agreed to share. Active · Ended on the title line; the whole row opens the split's dialog
 * (Change, End this split); New split is the same dialog with a policy lookup over the book. The Split column names
 * the people ("Dana 60% · Marcus 40%"); the policy, the client and each producer link to their page. The bookkeeper
 * reads: the dialog shows the values as text, with Close only.
 *
 * Order of the money, fixed: agency commission → the WRITER's pool → the owner's override → the split of the pool.
 * The non-writer's own level is not applied. Shares always add up to exactly 100%.
 */
type Share = { producerUserId: string; shareBps: number; isWriter: boolean };
export type SplitListRow = { setId: string; carrierId: string; carrierName: string | null; policyNumber: string; clientName: string | null; writerUserId: string | null; shares: Share[]; createdAt: string; endedAt: string | null };
export type SplitPerson = { userId: string; producerId: string; name: string };
type OverrideRow = { producerUserId: string; producerName: string; carrierId: string; carrierName: string; agencyLevelBps: number | null; producerLevelBps: number | null };
type PolicyHit = { carrierId: string; carrierName: string; policyNumber: string; clientName: string | null; writerUserId: string | null };
export type SplitPrefill = { carrier?: string; policy?: string; writer?: string; other?: string; share?: string };

const firstName = (name: string) => name.split(/\s+/)[0] || name;
const policyHref = (s: { carrierId: string; policyNumber: string }) => `/app/policies/carrier/${s.carrierId}/${encodeURIComponent(s.policyNumber)}`;

export function SplitsBoard({ rows, tab, people, canEdit, prefill }: { rows: SplitListRow[]; tab: "active" | "ended"; people: SplitPerson[]; canEdit: boolean; prefill: SplitPrefill | null }) {
  const router = useRouter();
  const path = usePathname();
  const [search, setSearch] = useState("");
  const [who, setWho] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(300, 52);
  const [open, setOpen] = useState<SplitListRow | null>(null);
  const [creating, setCreating] = useState<SplitPrefill | null>(prefill);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);
  const name = (id: string | null) => (id ? nameOf.get(id)?.name ?? "Producer" : "—");
  const person = (id: string) => {
    const p = nameOf.get(id);
    return p ? <Link className="hover:underline" href={`/app/producers/${p.producerId}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link> : "Producer";
  };

  const needle = search.trim().toLowerCase();
  const visible = rows
    .filter((s) => !who || s.shares.some((x) => x.producerUserId === who))
    .filter((s) => !needle || `${s.policyNumber} ${s.clientName ?? ""} ${s.carrierName ?? ""} ${s.shares.map((x) => name(x.producerUserId)).join(" ")}`.toLowerCase().includes(needle));
  const shown = paginate(visible, page, pageSize);
  const sharing = new Set(rows.flatMap((s) => s.shares.map((x) => x.producerUserId))).size;
  const inRows = people.filter((p) => rows.some((s) => s.shares.some((x) => x.producerUserId === p.userId)));
  const closeNew = () => { setCreating(null); if (prefill) router.replace(path + (tab === "ended" ? "?tab=ended" : "")); };

  return (
    <>
      {canEdit ? <StepSlot id={SPLITS_SLOT}><Button onClick={() => setCreating({})}>New split</Button></StepSlot> : null}
      <TableCard
        toolbar={rows.length === 0 ? undefined : (
          <DataToolbar actions={<span className="text-sm"><span className="font-semibold tabular-nums">{rows.length}</span> shared {rows.length === 1 ? "policy" : "policies"} · <span className="font-semibold tabular-nums">{sharing}</span> producers sharing</span>}>
            <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search policy or producer" label="Search splits" />
            <select aria-label="Producer" className={toolbarControl} value={who} onChange={(e) => { setWho(e.target.value); setPage(1); }}>
              <option value="">Every producer</option>
              {inRows.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          </DataToolbar>
        )}
        footer={rows.length === 0 ? undefined : (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">The writer&apos;s pool, at the writer&apos;s level; the override comes off first</p>
            {visible.length > pageSize ? <Pager page={shown.current} total={visible.length} noun="splits" pageSize={pageSize} onPage={setPage} /> : null}
          </div>
        )}
      >
        {rows.length === 0 ? (
          tab === "ended" ? <EmptyState title="No ended splits" hint="A split you end shows here, with the day it ended. Months already paid keep it." />
            : <EmptyState title="No shared policies" hint="When two producers agree to share a policy, record the split here so both statements show it." action={canEdit ? <Button onClick={() => setCreating({})}>New split</Button> : undefined} />
        ) : visible.length === 0 ? <NoMatches noun="splits" onClear={() => { setSearch(""); setWho(""); }} /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-[16%]">Policy</TableHead><TableHead className="w-[18%]">Client</TableHead><TableHead className="w-[14%]">Carrier</TableHead>
              <TableHead className="w-[16%]">Writer</TableHead><TableHead>Split</TableHead><TableHead className="w-[13%]">{tab === "ended" ? "Ended" : "Since"}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.rows.map((s) => {
                const writer = s.shares.find((x) => x.isWriter);
                const none = <span className="text-muted-foreground">—</span>;
                return (
                  <TableRow key={s.setId} className="cursor-pointer" onClick={() => setOpen(s)}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link className="hover:underline" href={policyHref(s)} onClick={(e) => e.stopPropagation()}>{s.policyNumber}</Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{s.clientName ? <Link className="hover:underline" href={`/app/policies?q=${encodeURIComponent(s.clientName)}`} onClick={(e) => e.stopPropagation()}>{s.clientName}</Link> : none}</TableCell>
                    <TableCell className="whitespace-nowrap">{s.carrierName ?? none}</TableCell>
                    <TableCell className="whitespace-nowrap">{writer ? person(writer.producerUserId) : none}</TableCell>
                    {/* Who it is shared with reads here, by first name, with each share. */}
                    <TableCell className="whitespace-nowrap tabular-nums">{s.shares.map((x) => `${firstName(name(x.producerUserId))} ${bpsToPercent(x.shareBps)}`).join(" · ")}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{usDate(tab === "ended" ? s.endedAt : s.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {open ? <SplitDialog split={open} people={people} canEdit={canEdit && tab === "active"} onClose={() => setOpen(null)} /> : null}
      {creating ? <SplitDialog prefill={creating} people={people} canEdit={canEdit} onClose={closeNew} /> : null}
    </>
  );
}

/** 8·1 · the split dialog (lg): a split (row click) or New split (empty, with a policy lookup). */
function SplitDialog({ split, prefill, people, canEdit, onClose }: { split?: SplitListRow; prefill?: SplitPrefill; people: SplitPerson[]; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const levels = useAgencyData<{ rows: OverrideRow[] }>(canEdit ? "/api/app/agency/overrides" : null);
  const name = (id: string) => people.find((p) => p.userId === id)?.name ?? "Producer";
  const startWriter = split?.writerUserId ?? prefill?.writer ?? "";
  const startOther = split?.shares.find((x) => !x.isWriter)?.producerUserId ?? prefill?.other ?? "";
  const [policy, setPolicy] = useState<PolicyHit | null>(split ? { carrierId: split.carrierId, carrierName: split.carrierName ?? "Carrier", policyNumber: split.policyNumber, clientName: split.clientName, writerUserId: split.writerUserId }
    : prefill?.carrier && prefill.policy ? { carrierId: prefill.carrier, carrierName: "", policyNumber: prefill.policy, clientName: null, writerUserId: prefill.writer ?? null } : null);
  const [writer, setWriter] = useState(startWriter);
  // Two producers: the second share is the rest of the first. Three or more: one share each.
  const [shares, setShares] = useState<Array<{ userId: string; pct: string }>>(() => split && split.shares.length > 2
    ? split.shares.map((x) => ({ userId: x.producerUserId, pct: bpsToPercent(x.shareBps).replace("%", "") }))
    : [{ userId: startWriter, pct: split ? bpsToPercent(split.shares.find((x) => x.isWriter)?.shareBps ?? 6000).replace("%", "") : prefill?.share ?? "60" }, { userId: startOther, pct: "" }]);
  const [premium, setPremium] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const many = shares.length > 2;
  const other = many ? "" : shares[1]?.userId ?? "";
  const writerBps = percentToBps(shares[0]?.pct ?? "");
  const parts: Array<{ producerUserId: string; shareBps: number }> | null = many
    ? (shares.every((s) => percentToBps(s.pct) !== null) ? shares.map((s) => ({ producerUserId: s.userId, shareBps: percentToBps(s.pct)! })) : null)
    : writerBps !== null && writerBps > 0 && writerBps < 10000 && other ? [{ producerUserId: writer, shareBps: writerBps }, { producerUserId: other, shareBps: 10000 - writerBps }] : null;
  const total = parts?.reduce((sum, s) => sum + s.shareBps, 0) ?? 0;
  const carrierName = policy?.carrierName || levels.data?.rows.find((r) => r.carrierId === policy?.carrierId)?.carrierName || "this carrier";
  const levelOf = (userId: string) => levels.data?.rows.find((r) => r.carrierId === policy?.carrierId && r.producerUserId === userId);
  const missingLevel = canEdit && levels.data && policy && other && levelOf(other)?.producerLevelBps == null ? `${name(other)} has no contract level with ${carrierName}. Set it on their Carriers tab first.` : null;
  const shareError = !parts ? (many ? "Enter each share as a percent." : "Enter the writer's share as a percent between 1 and 99.") : total !== 10000 ? `The shares add up to ${bpsToPercent(total)}; they must make 100%.` : null;

  const partsKey = JSON.stringify(parts);
  const preview = useMemo(() => {
    const cents = dollarsToCents(premium);
    const lv = levelOf(writer);
    if (!cents || !lv || !parts || total !== 10000) return null;
    const result = computeOverride({ annualPremiumCents: cents, agencyLevelBps: lv.agencyLevelBps, producerLevelBps: lv.producerLevelBps });
    return { result, split: result.producerPoolCents === null ? null : splitPool(result.producerPoolCents, parts) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premium, levels.data, writer, partsKey, total, policy?.carrierId]);

  // The writer is the policy's writing producer once a policy is chosen (New split).
  useEffect(() => {
    if (split || !policy?.writerUserId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a chosen policy names its writer
    setWriter(policy.writerUserId);
    setShares((cur) => [{ ...cur[0], userId: policy.writerUserId! }, ...cur.slice(1)]);
  }, [policy, split]);

  async function save() {
    if (!policy || !parts || total !== 10000) return;
    setBusy(true);
    setProblem(null);
    const { error } = await sendJson("/api/app/agency/splits", "PUT", { carrierId: policy.carrierId, policyNumber: policy.policyNumber, writerUserId: writer, shares: parts });
    setBusy(false);
    if (error) { setProblem(error); return; }
    notify.done(`Split saved for ${policy.policyNumber}. Statements from now on divide its pool ${parts.map((p) => bpsToPercent(p.shareBps)).join(" / ")}.`);
    onClose();
    router.refresh();
  }

  async function end() {
    if (!split) return;
    setBusy(true);
    setProblem(null);
    const { error } = await sendJson("/api/app/agency/splits", "PUT", { carrierId: split.carrierId, policyNumber: split.policyNumber, writerUserId: split.writerUserId ?? writer, shares: [] });
    setBusy(false);
    setEnding(false);
    if (error) { setProblem(/schema|not available|pending/i.test(error) ? "Ending a split is not available yet. Try again later." : error); return; }
    notify.done(`Split ended. ${name(split.writerUserId ?? writer)} gets the whole pool from today.`);
    onClose();
    router.refresh();
  }

  const title = split ? `Split on ${split.policyNumber}${split.clientName ? ` · ${split.clientName}` : ""}` : "New split";
  const description = split
    ? `${split.carrierName ?? "Carrier"} · ${split.endedAt ? `ended ${usDate(split.endedAt)}` : `since ${usDate(split.createdAt)}`}. The pool uses the writer's level; the other producer's own level is not applied.`
    : "For a policy two producers agreed to share. Statements from now on divide its pool.";
  const producers = people.filter((p) => p.userId !== writer);

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
        <DialogContent size={WIDE_DIALOG}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {!canEdit ? (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Writer</dt><dd className="m-0">{split ? name(split.writerUserId ?? "") : "—"}</dd>
              <dt className="text-muted-foreground">Split</dt><dd className="m-0 tabular-nums">{split ? split.shares.map((x) => `${name(x.producerUserId)} ${bpsToPercent(x.shareBps)}`).join(" · ") : "—"}</dd>
            </dl>
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              {!split ? <PolicyLookup value={policy} onChange={setPolicy} name={name} /> : null}
              {many ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {shares.map((s, i) => (
                    <Field key={s.userId} label={`${name(s.userId)}${i === 0 ? " (writer)" : ""} · share (%)`} htmlFor={`share-${s.userId}`}>
                      <input id={`share-${s.userId}`} inputMode="decimal" className={control} value={s.pct} onChange={(e) => setShares((cur) => cur.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
                    </Field>
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Writer" htmlFor="split-writer" hint={!split && policy?.writerUserId ? "The policy's writing producer" : undefined}>
                    <select id="split-writer" className={control} value={writer} onChange={(e) => { setWriter(e.target.value); setShares((cur) => [{ ...cur[0], userId: e.target.value }, cur[1]]); }}>
                      <option value="">Choose a producer</option>
                      {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Shared with" htmlFor="split-other" error={missingLevel ?? undefined}>
                    <select id="split-other" className={control} value={other} onChange={(e) => setShares((cur) => [cur[0], { userId: e.target.value, pct: "" }])}>
                      <option value="">Choose a producer</option>
                      {producers.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Writer's share (%)" htmlFor="split-share" hint={writerBps !== null && writerBps > 0 && writerBps < 10000 && other ? `${name(other)} gets ${bpsToPercent(10000 - writerBps)}` : undefined}>
                    <input id="split-share" inputMode="decimal" className={control} value={shares[0]?.pct ?? ""} onChange={(e) => setShares((cur) => [{ ...cur[0], pct: e.target.value }, cur[1]])} />
                  </Field>
                  <Field label="Annual premium, to preview ($)" htmlFor="split-premium">
                    <input id="split-premium" inputMode="decimal" placeholder="e.g. 1200" className={control} value={premium} onChange={(e) => setPremium(e.target.value)} />
                  </Field>
                </div>
              )}
              {preview ? (
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                  <dt className="text-muted-foreground">1 · Agency commission</dt><dd className="m-0 tabular-nums">{preview.result.agencyCommissionCents === null ? "—" : dollars(preview.result.agencyCommissionCents)}</dd>
                  <dt className="text-muted-foreground">2 · Writer&apos;s pool</dt><dd className="m-0 tabular-nums">{preview.result.producerPoolCents === null ? "— set the writer's level first" : dollars(preview.result.producerPoolCents)}</dd>
                  <dt className="text-muted-foreground">3 · Override</dt><dd className="m-0 tabular-nums">{preview.result.overrideCents === null ? "—" : dollars(-preview.result.overrideCents)}</dd>
                  <dt className="text-muted-foreground">4 · Split of the pool</dt><dd className="m-0 tabular-nums">{preview.split ? preview.split.map((p) => `${name(p.producerUserId)} ${dollars(p.amountCents)}`).join(" · ") : "—"}</dd>
                </dl>
              ) : null}
              {problem ? <p role="alert" className="m-0 text-[var(--error-ink)]">{problem}</p> : null}
            </div>
          )}
          <DialogFooter className={split && canEdit ? "sm:justify-between" : undefined}>
            {split && canEdit ? <Button variant="outline" className="text-[var(--error-ink)]" onClick={() => setEnding(true)} disabled={busy}>End this split</Button> : null}
            <span className="flex gap-2">
              {canEdit ? <>
                <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button onClick={() => void save()} disabled={busy || !policy || !writer || Boolean(shareError) || Boolean(missingLevel) || (!many && writer === other)}>{busy ? "Saving…" : "Save split"}</Button>
              </> : <Button variant="outline" onClick={onClose}>Close</Button>}
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {split ? (
        <ConfirmDialog
          open={ending}
          onOpenChange={setEnding}
          busy={busy}
          title={`End the split on ${split.policyNumber}?`}
          description={`From ${usDate(new Date().toISOString())}, ${name(split.writerUserId ?? writer)}'s statements get the whole pool. Months already paid keep the split.`}
          confirmLabel="End the split"
          cancelLabel="Keep the split"
          onConfirm={() => void end()}
        />
      ) : null}
    </>
  );
}

/** New split's policy: search the book by number or client; a pick names the carrier and the writer. */
function PolicyLookup({ value, onChange, name }: { value: PolicyHit | null; onChange: (next: PolicyHit | null) => void; name: (id: string) => string }) {
  const [q, setQ] = useState(value?.policyNumber ?? "");
  const [hits, setHits] = useState<PolicyHit[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || (value && term === value.policyNumber)) { setHits([]); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/app/agency/splits?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then(async (res) => { const body = await res.json().catch(() => null); if (!res.ok) throw new Error(body?.error ?? "The book could not be searched."); setHits(body.policies ?? []); setProblem(null); })
        .catch((error: unknown) => { if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : "The book could not be searched."); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, value]);
  return (
    <Field label="Policy" htmlFor="split-policy" error={problem ?? undefined} hint={value ? `${value.policyNumber}${value.clientName ? ` · ${value.clientName}` : ""}${value.carrierName ? ` · ${value.carrierName}` : ""}${value.writerUserId ? ` · written by ${name(value.writerUserId)}` : ""}` : "Policy number or client name"}>
      <span className="relative block">
        <Search className="pointer-events-none absolute left-3 top-[calc(50%+3px)] size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input id="split-policy" className={`${control} pl-9`} autoComplete="off" value={q} onChange={(e) => { setQ(e.target.value); if (value) onChange(null); }} />
      </span>
      {hits.length ? (
        <ul role="listbox" aria-label="Policies" className="m-0 mt-1 max-h-48 list-none overflow-y-auto rounded-md border border-border p-1">
          {hits.map((h) => (
            <li key={`${h.carrierId}|${h.policyNumber}`}>
              <button type="button" role="option" aria-selected={false} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-alt)]" onClick={() => { onChange(h); setQ(h.policyNumber); setHits([]); }}>
                <span className="font-mono text-xs">{h.policyNumber}</span> · {h.clientName ?? "No client"} · {h.carrierName}{h.writerUserId ? ` · written by ${name(h.writerUserId)}` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  );
}
