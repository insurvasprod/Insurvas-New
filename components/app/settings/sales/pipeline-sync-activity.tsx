"use client";

/**
 * Settings › Application stages › Activity (redesign 2026-10-30, canvas boards PsShared + PsEdits): proof the
 * sync works on one pipeline, and the two ways to catch it up.
 *
 * The sync's recent moves and 30-day count load with the tab. "Check cards" runs the sync's own
 * evaluation over the pipeline's open cases: cards due a move (their application last changed before the
 * map did — a map change never moves cards by itself), cards a person is holding, and states with
 * nowhere to go. "Move N cards now" moves the due ones and "Put it back" one held card, each after a
 * question, by the sync's rules (owner 2026-10-30: "add any features that would help the user").
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, RefreshCw, SearchCheck, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState, LoadingRows } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Callout } from "@/components/app/settings/primitives";
import { notify } from "@/lib/notify";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import type { CheckedCard, StageMapActivity } from "@/lib/salesSettings/stageMapActivity";
import type { PipelineSyncKey } from "@/lib/applications/settingsFixtures";

import { stateLabel } from "./pipeline-sync-parts";

const API = "/api/app/settings/sales/stage-map/activity";

export function PipelineSyncActivity({ pipelineId, pipelineName, sample, dirty, onMapState }: {
  pipelineId: string;
  pipelineName: string;
  sample: boolean;
  /** This pipeline's map has unsaved changes: moving cards now would follow the saved map, not the draft. */
  dirty: boolean;
  /** Jump to the Map tab at a state that has nowhere to go. */
  onMapState: (key: PipelineSyncKey) => void;
}) {
  const [data, setData] = useState<StageMapActivity | null>(sample ? { pipelineId, moved30: 0, moves: [], check: null } : null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (check: boolean) => {
    if (sample) return;
    if (check) setChecking(true);
    setError(null);
    try {
      const res = await fetch(`${API}?pipeline=${encodeURIComponent(pipelineId)}${check ? "&check=1" : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Activity could not be loaded.");
      setData(body as StageMapActivity);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activity could not be loaded.");
    } finally {
      setChecking(false);
    }
  }, [pipelineId, sample]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(false); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function post(payload: Record<string, string>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't go through. Try again.");
      return body as { moved: number | boolean; checked?: number; toStageName?: string | null };
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function moveDue(due: CheckedCard[]) {
    const ok = await confirmAction({
      title: `Move ${due.length} ${due.length === 1 ? "card" : "cards"} on ${pipelineName}?`,
      description: "Each goes to the stage its application is at, by the sync's rules. Cards a person moved stay where they are. Applications don't change.",
      confirmLabel: `Move ${due.length === 1 ? "card" : "cards"}`,
      cancelLabel: "Not now",
      destructive: false,
    });
    if (!ok) return;
    const result = await post({ action: "move_due", pipeline_id: pipelineId }, "move");
    if (!result) return;
    notify.done(`${Number(result.moved)} ${Number(result.moved) === 1 ? "card" : "cards"} moved on ${pipelineName}`);
    await load(true);
  }

  async function putBack(card: CheckedCard) {
    const ok = await confirmAction({
      title: `Put ${card.lead}'s card back?`,
      description: `It moves from ${card.boardStage ?? "no stage"} to ${card.applicationStage ?? "where its application says"}, and the sync follows it again from here.`,
      confirmLabel: "Put it back",
      cancelLabel: "Leave it",
      destructive: false,
    });
    if (!ok) return;
    const result = await post({ action: "put_back", lead_id: card.leadId }, card.leadId);
    if (!result) return;
    notify.done(`${card.lead} is back at ${result.toStageName ?? card.applicationStage ?? "its stage"}`);
    await load(true);
  }

  if (error && !data) return <div className="p-4"><Callout tone="error" title={error}><Button type="button" variant="outline" className="mt-2" onClick={() => void load(false)}>Try again</Button></Callout></div>;
  if (!data) return <div className="px-4 pb-4"><LoadingRows rows={4} columns={4} /></div>;

  const check = data.check;
  const unmapped = check ? (Object.entries(check.unmapped) as [PipelineSyncKey, number][]).filter(([, n]) => n > 0) : [];
  const unmappedTotal = unmapped.reduce((sum, [, n]) => sum + n, 0);
  const zone = viewerTimeZone();
  const notYet = "Run Check cards";

  return (
    <div className="flex flex-col gap-4 pb-2">
      {error && <div className="px-4"><Callout tone="error" title={error} /></div>}
      <div className="px-4">
        <StatStrip label={`${pipelineName} sync activity`}>
          <StatTile label="Moved by the sync" value={data.moved30} footnote="Last 30 days" />
          <StatTile label="Ready to move" value={check ? check.due.length : "—"} footnote={check ? (check.due.length ? "Their applications changed before the map" : "Every card is where it belongs") : notYet} />
          <StatTile label="Held by a person" value={check ? check.held.length : "—"} footnote={check ? "Board and application disagree" : notYet} />
          <StatTile label="Nowhere to go" value={check ? unmappedTotal : "—"} footnote={check ? (unmappedTotal ? unmapped.map(([k, n]) => `${stateLabel(k)} ×${n}`).join(" · ") : "Every open case can move") : notYet} />
        </StatStrip>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4">
        <Button type="button" variant={check?.due.length ? "outline" : "default"} onClick={() => void load(true)} disabled={checking || sample || Boolean(busy)}>
          {checking ? <RefreshCw aria-hidden="true" className="animate-spin" /> : <SearchCheck aria-hidden="true" />}
          {checking ? "Checking open cases" : check ? "Check again" : "Check cards"}
        </Button>
        {check && check.due.length > 0 && (
          <Button type="button" onClick={() => void moveDue(check.due)} disabled={Boolean(busy) || dirty} title={dirty ? "Save or discard this pipeline's changes first — cards move by the saved map" : undefined}>
            {busy === "move" ? <RefreshCw aria-hidden="true" className="animate-spin" /> : <ArrowRightLeft aria-hidden="true" />}
            {busy === "move" ? "Moving cards" : `Move ${check.due.length} ${check.due.length === 1 ? "card" : "cards"} now`}
          </Button>
        )}
        <span className="text-sm text-[var(--body)]">
          {check
            ? `Looked at ${check.checked} open ${check.checked === 1 ? "case" : "cases"} on ${pipelineName}${check.capped ? " (the newest)" : ""}.${dirty ? " Save first: cards move by the saved map." : ""}`
            : "Compares each open case's card with its application. Moves nothing."}
        </span>
      </div>

      {check && unmapped.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4">
          {unmapped.map(([key, n]) => (
            <Button key={key} type="button" variant="outline" size="sm" onClick={() => onMapState(key)}>Map {stateLabel(key)} ({n})</Button>
          ))}
        </div>
      )}

      {check && check.due.length > 0 && (
        <CardTable title="Ready to move" cards={check.due} />
      )}

      {check && check.held.length > 0 && (
        <CardTable
          title="Held where a person put them"
          cards={check.held}
          action={(card) => (
            <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void putBack(card)}>
              {busy === card.leadId ? <RefreshCw aria-hidden="true" className="animate-spin" /> : <Undo2 aria-hidden="true" />}Put it back
            </Button>
          )}
        />
      )}

      <section aria-label="Recent automatic moves">
        <h3 className="m-0 px-4 pb-2 text-sm font-semibold text-[var(--ink)]">Recent automatic moves</h3>
        {data.moves.length === 0 ? (
          <EmptyState title="No automatic moves yet" hint={`When an application on ${pipelineName} reaches a mapped state, its card's move shows here.`} />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Moved</TableHead><TableHead>Because it is</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.moves.map((move, i) => (
                <TableRow key={`${move.leadId}-${move.at}-${i}`}>
                  <TableCell><Link className="font-medium text-[var(--ink)] hover:underline" href={`/app/leads/${move.leadId}`}>{move.lead}</Link></TableCell>
                  <TableCell><span className="text-[var(--body)]">{move.from ?? "No stage"}</span> → {move.to}</TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {move.byPerson ? <StatusChip tone="info">Moved by a person here</StatusChip> : move.state ? <StatusChip tone="action">{move.state}</StatusChip> : <span className="text-[var(--body)]">—</span>}
                      {move.application && <Link className="text-xs font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/applications/${move.application.caseId}?attempt=${move.application.attemptNo}`}>{move.application.attemptNo > 1 ? `Application · attempt ${move.application.attemptNo}` : "Open application"}</Link>}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--body)]">{dateTime(move.at, zone, { clock: "12h" })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function CardTable({ title, cards, action }: { title: string; cards: CheckedCard[]; action?: (card: CheckedCard) => React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="m-0 px-4 pb-2 text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <Table>
        <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>On the board</TableHead><TableHead>The application says</TableHead><TableHead className="text-right"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {cards.map((card) => (
            <TableRow key={card.leadId}>
              <TableCell><Link className="font-medium text-[var(--ink)] hover:underline" href={`/app/leads/${card.leadId}`}>{card.lead}</Link></TableCell>
              <TableCell>{card.boardStage ?? "No stage"}</TableCell>
              <TableCell>{card.applicationStage ?? "—"}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-2">
                  {action?.(card)}
                  <Button asChild variant="ghost" size="sm"><Link href={`/app/leads/${card.leadId}`}>Open lead</Link></Button>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
