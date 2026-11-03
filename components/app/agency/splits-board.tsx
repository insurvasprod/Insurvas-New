"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Button } from "@/components/ui/button";
import { bpsToPercent, dollars, dollarsToCents, percentToBps } from "@/lib/agency/constants";
import { computeOverride, splitPool } from "@/lib/agency/overrideCore";
import { sendJson, useAgencyData } from "./use-agency-data";

/** A form field: the toolbar control, filling its grid cell so a narrow column never scrolls sideways. */
const field = `${toolbarControl} w-full min-w-0`;

type Split = { setId: string; carrierId: string; carrierName: string | null; policyNumber: string; writerUserId: string | null; shares: Array<{ producerUserId: string; shareBps: number; isWriter: boolean }>; createdAt: string };
type OverrideRow = { producerUserId: string; producerName: string; carrierId: string; carrierName: string; agencyLevelBps: number | null; producerLevelBps: number | null };

/** The form's address for a split, prefilled (Change on a row). */
export function splitFormHref(split?: { carrierId: string; policyNumber: string; writer: string; other: string; writerBps: number }) {
  if (!split) return "/app/commission-splits/new";
  const q = new URLSearchParams({ carrier: split.carrierId, policy: split.policyNumber, writer: split.writer, other: split.other, share: String(split.writerBps / 100) });
  return `/app/commission-splits/new?${q}`;
}

/**
 * AG-1.6 · Commission splits, Accounting › Commission splits (moved from Team 2026-11-03) — policies two producers
 * agreed to share. Not an override: the override is computed, a split is entered. The list; New split (on the
 * title line) and Change (on a row) open the form page, /app/commission-splits/new.
 */
export function SplitsBoard({ canEdit }: { canEdit: boolean }) {
  const splits = useAgencyData<{ splits: Split[] }>("/api/app/agency/splits");
  const levels = useAgencyData<{ rows: OverrideRow[] }>("/api/app/agency/overrides");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(320, 45);

  const names = useMemo(() => new Map((levels.data?.rows ?? []).map((r) => [r.producerUserId, r.producerName])), [levels.data]);
  const all = splits.data?.splits ?? [];
  const rows = all.filter((s) => !search.trim() || `${s.policyNumber} ${s.carrierName ?? ""} ${s.shares.map((x) => names.get(x.producerUserId) ?? "").join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const shown = paginate(rows, page, pageSize);
  const people = new Set(all.flatMap((s) => s.shares.map((x) => x.producerUserId))).size;
  const thisMonth = all.filter((s) => s.createdAt.slice(0, 7) === new Date().toISOString().slice(0, 7)).length;

  return (
    <>
      {splits.data && all.length > 0 && (
        <StatStrip label="Commission splits">
          <StatTile label="Shared policies" value={String(all.length)} />
          <StatTile label="Producers sharing" value={String(people)} />
          <StatTile label="Added this month" value={String(thisMonth)} />
        </StatStrip>
      )}
      <TableCard toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => { splits.reload(); levels.reload(); }} refreshing={splits.refreshing} />}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search policy or producer" label="Search splits" />
        </DataToolbar>
      } footer={rows.length ? <Pager page={shown.current} total={rows.length} noun="splits" pageSize={pageSize} onPage={setPage} /> : undefined}>
        {splits.error ? <ErrorState detail={splits.error} /> : splits.loading ? <SectionLoading rows={4} columns={6} label="Loading splits" /> : all.length === 0 ? (
          <EmptyState title="No shared policies" hint="When two producers agree to share a policy, record the split here so both statements show it." action={canEdit ? <Button asChild><Link href={splitFormHref()}>New split</Link></Button> : undefined} />
        ) : rows.length === 0 ? <NoMatches noun="splits" by="search" onClear={() => setSearch("")} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Carrier</TableHead><TableHead>Writer</TableHead><TableHead>Shared with</TableHead><TableHead className="text-right">Split</TableHead><TableHead>Since</TableHead>{canEdit && <TableHead className="text-right"><span className="sr-only">Change</span></TableHead>}</TableRow></TableHeader>
            <TableBody>
              {shown.rows.map((s) => {
                const writer = s.shares.find((x) => x.isWriter);
                const others = s.shares.filter((x) => !x.isWriter);
                return (
                  <TableRow key={s.setId}>
                    <TableCell className="font-mono text-xs">{s.policyNumber}</TableCell>
                    <TableCell>{s.carrierName ?? "—"}</TableCell>
                    <TableCell>{writer ? names.get(writer.producerUserId) ?? "Producer" : "—"}</TableCell>
                    <TableCell>{others.map((o) => names.get(o.producerUserId) ?? "Producer").join(", ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.shares.map((x) => bpsToPercent(x.shareBps).replace("%", "")).join(" / ")}</TableCell>
                    <TableCell className="tabular-nums">{s.createdAt.slice(0, 10)}</TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        {writer && others.length === 1 ? <Button asChild size="sm" variant="outline"><Link href={splitFormHref({ carrierId: s.carrierId, policyNumber: s.policyNumber, writer: writer.producerUserId, other: others[0].producerUserId, writerBps: writer.shareBps })}>Change</Link></Button> : null}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </>
  );
}

/**
 * AG-1.6 · the split form, a page of its own (foundation pass 2026-11-03; it was a side panel). Order, fixed: agency
 * commission → the WRITER's pool → the owner's override → the split of the pool. The non-writer's own level is not
 * applied; he gets his share of the writer's pool. Shares always add up to exactly 100%: the second share is the
 * rest of the first, so nothing can be normalised. A typed premium previews the four steps with the same integer
 * engine the database uses; it is never saved.
 */
export function SplitForm({ initial }: { initial: { carrier?: string; policy?: string; writer?: string; other?: string; share?: string } }) {
  const router = useRouter();
  const levels = useAgencyData<{ rows: OverrideRow[] }>("/api/app/agency/overrides");
  const names = useMemo(() => new Map((levels.data?.rows ?? []).map((r) => [r.producerUserId, r.producerName])), [levels.data]);
  const carriers = useMemo(() => [...new Map((levels.data?.rows ?? []).map((r) => [r.carrierId, r.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [levels.data]);
  const producers = useMemo(() => [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])), [names]);
  const [carrierId, setCarrier] = useState(initial.carrier ?? "");
  const [policyNumber, setPolicy] = useState(initial.policy ?? "");
  const [writer, setWriter] = useState(initial.writer ?? "");
  const [other, setOther] = useState(initial.other ?? "");
  const [writerPercent, setPercent] = useState(initial.share ?? "60");
  const [premium, setPremium] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Defaults once the lists arrive: the first carrier, the first two producers.
  const c = carrierId || carriers[0]?.[0] || "";
  const w = writer || producers[0]?.[0] || "";
  const o = other && other !== w ? other : producers.find(([id]) => id !== w)?.[0] ?? "";

  const writerBps = percentToBps(writerPercent);
  const validShare = writerBps !== null && writerBps > 0 && writerBps < 10000;
  const preview = useMemo(() => {
    const cents = dollarsToCents(premium);
    const lv = (levels.data?.rows ?? []).find((r) => r.carrierId === c && r.producerUserId === w);
    if (!validShare || !cents || !lv) return null;
    const result = computeOverride({ annualPremiumCents: cents, agencyLevelBps: lv.agencyLevelBps, producerLevelBps: lv.producerLevelBps });
    const parts = result.producerPoolCents === null ? null : splitPool(result.producerPoolCents, [{ producerUserId: w, shareBps: writerBps! }, { producerUserId: o, shareBps: 10000 - writerBps! }]);
    return { result, parts };
  }, [premium, levels.data, c, w, o, validShare, writerBps]);

  async function save() {
    if (!validShare) return;
    setBusy(true);
    setProblem(null);
    const { error } = await sendJson("/api/app/agency/splits", "PUT", {
      carrierId: c,
      policyNumber: policyNumber.trim(),
      writerUserId: w,
      shares: [{ producerUserId: w, shareBps: writerBps }, { producerUserId: o, shareBps: 10000 - writerBps! }],
    });
    setBusy(false);
    if (error) { setProblem(error); return; }
    notify.done(`Split saved for ${policyNumber.trim()}. Statements from now on divide its pool ${bpsToPercent(writerBps!)} / ${bpsToPercent(10000 - writerBps!)}.`);
    router.push("/app/commission-splits");
  }

  if (levels.error) return <TableCard><ErrorState detail={levels.error} /></TableCard>;
  if (levels.loading) return <TableCard><SectionLoading rows={6} columns={2} label="Loading producers and carriers" /></TableCard>;
  if (producers.length < 2 || carriers.length === 0) return <TableCard><EmptyState title="Nothing to split yet" hint="A split needs two working producers with a contract level on the same carrier. Set levels on each producer's Carriers tab." action={<Button asChild variant="outline"><Link href="/app/hierarchy">Open the hierarchy</Link></Button>} /></TableCard>;

  return (
    <TableCard title="The split" description="The pool uses the writer's level. The other producer's own level is not applied."
      footer={<div className="flex w-full items-center justify-end gap-2"><Button asChild variant="outline"><Link href="/app/commission-splits">Cancel</Link></Button><Button onClick={save} disabled={busy || !policyNumber.trim() || !validShare || !o || w === o}>{busy ? "Saving…" : "Save split"}</Button></div>}>
      <div className="grid max-w-3xl gap-4 p-4 text-sm md:grid-cols-2">
        <label className="grid gap-1 font-medium">Carrier<select className={field} value={c} onChange={(e) => setCarrier(e.target.value)}>{carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="grid gap-1 font-medium">Policy number<input className={`${field} font-mono`} value={policyNumber} onChange={(e) => setPolicy(e.target.value)} autoComplete="off" /></label>
        <label className="grid gap-1 font-medium">Writer<select className={field} value={w} onChange={(e) => setWriter(e.target.value)}>{producers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="grid gap-1 font-medium">Shared with<select className={field} value={o} onChange={(e) => setOther(e.target.value)}>{producers.filter(([id]) => id !== w).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="grid gap-1 font-medium">Writer&apos;s share (%)<input inputMode="decimal" className={field} value={writerPercent} onChange={(e) => setPercent(e.target.value)} /></label>
        <div className="grid gap-1 font-medium">The other producer gets<span className="flex h-9 items-center font-normal tabular-nums">{validShare ? bpsToPercent(10000 - writerBps!) : "—"}</span></div>
        <label className="grid gap-1 font-medium md:col-span-2">Annual premium, to preview ($)<input inputMode="decimal" placeholder="e.g. 1200" className={`${field} max-w-xs`} value={premium} onChange={(e) => setPremium(e.target.value)} /></label>
        {preview && (
          <dl className="grid gap-x-6 gap-y-1 md:col-span-2 md:grid-cols-[auto_1fr]">
            <dt className="text-[var(--muted)]">1 · Agency commission</dt><dd className="tabular-nums">{preview.result.agencyCommissionCents === null ? "—" : dollars(preview.result.agencyCommissionCents)}</dd>
            <dt className="text-[var(--muted)]">2 · Writer&apos;s pool</dt><dd className="tabular-nums">{preview.result.producerPoolCents === null ? "— set the writer's level first" : dollars(preview.result.producerPoolCents)}</dd>
            <dt className="text-[var(--muted)]">3 · Override</dt><dd className="tabular-nums">{preview.result.overrideCents === null ? "—" : dollars(preview.result.overrideCents)}</dd>
            <dt className="text-[var(--muted)]">4 · Split of the pool</dt><dd className="tabular-nums">{preview.parts ? preview.parts.map((p) => `${names.get(p.producerUserId) ?? "Producer"} ${dollars(p.amountCents)}`).join(" · ") : "—"}</dd>
          </dl>
        )}
        {problem && <p role="alert" className="text-[var(--error-ink)] md:col-span-2">{problem}</p>}
      </div>
    </TableCard>
  );
}
