"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingRows } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fileDay } from "@/lib/ingestion/constants";
import type { Preview, PreviewLine } from "@/lib/pipelineRules/store";

const ENDPOINT = "/api/app/pipeline-rules";
const CARRIER_TERMS = "/app/book-setup/carrier-rules";

const OUTCOME: Record<PreviewLine["outcome"], [string, StatusTone]> = {
  move: ["Would move", "action"],
  hold: ["Held", "warning"],
  capped: ["Stops at the cap", "danger"],
  skip: ["Skipped", "neutral"],
  wait: ["Waits", "info"],
};

/** What a rule would do on today's data, one line a lead: would move, or skipped and why. */
export function PreviewLines({ lines }: { lines: PreviewLine[] }) {
  if (lines.length === 0) return <EmptyState title="Nothing for this rule today" hint="No policy has this event now. A rule only acts on what happens to a policy linked to a lead." />;
  return (
    <div className="max-h-[60vh] overflow-auto">
      <Table className="min-w-[820px]">
        <TableHeader><TableRow><TableHead className="w-[150px]">Result</TableHead><TableHead>Lead</TableHead><TableHead>Policy</TableHead><TableHead>Because</TableHead><TableHead>Card</TableHead><TableHead>Why</TableHead></TableRow></TableHeader>
        <TableBody>
          {lines.map((line, index) => (
            <TableRow key={`${line.policyNumber}-${line.carrierId}-${index}`}>
              <TableCell><StatusChip tone={OUTCOME[line.outcome][1]}>{OUTCOME[line.outcome][0]}</StatusChip></TableCell>
              <TableCell className="whitespace-nowrap font-medium text-foreground">{line.leadName ?? (line.leadId ? "A lead" : "No lead linked")}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums" title={line.carrierName ?? undefined}>{line.policyNumber}</TableCell>
              <TableCell className="whitespace-nowrap">{line.because || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="whitespace-nowrap">{line.outcome === "move" ? `${line.fromStage ?? "No stage"} → ${line.toStage ?? "the rule's stage"}` : line.fromStage ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="whitespace-nowrap">{line.outcome === "move" ? (line.note ? <span title={line.note}>Adds a note</span> : "No note") : line.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Preview on today's data (mockup r7 2·5, Dialog 2xl): the run's own checks on today's book, a table to read; it
 * writes nothing. `body` is the preview request (a saved rule, or the form as it stands); `initial` is a preview
 * the server already ran (a read-only account cannot POST).
 */
export function PreviewDialog({ open, onOpenChange, body, initial, graceEvent = true }: { open: boolean; onOpenChange: (open: boolean) => void; body: Record<string, unknown> | null; initial?: Preview | null; graceEvent?: boolean }) {
  // The answer is kept with the request it answers, so a new request shows loading until its own answer is in.
  const [result, setResult] = useState<{ request: string; data: Preview | null; error: string | null } | null>(null);
  const request = body ? JSON.stringify(body) : null;

  useEffect(() => {
    if (!open || !request) return;
    let gone = false;
    void (async () => {
      try {
        const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: request });
        const json = (await response.json().catch(() => ({}))) as Preview & { error?: string; message?: string | null };
        if (!response.ok) throw new Error(json.error ?? "The preview did not run.");
        if (!json.available) throw new Error(json.message ?? "Card moves need a database update.");
        if (!gone) setResult({ request, data: json, error: null });
      } catch (cause) {
        if (!gone) setResult({ request, data: null, error: cause instanceof Error ? cause.message : "The preview did not run." });
      }
    })();
    return () => { gone = true; };
  }, [open, request]);

  const mine = request && result?.request === request ? result : null;
  const shown = request ? mine?.data ?? null : initial ?? null;
  const error = mine?.error ?? null;
  const moves = shown ? shown.lines.filter((l) => l.outcome === "move").length : 0;
  const noGrace = graceEvent && shown ? shown.carriersWithoutGrace : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Preview on today&apos;s data</DialogTitle>
          <DialogDescription>{shown ? `As of ${fileDay(shown.asOf)} · ${moves} would move · ${shown.lines.length - moves} not · writes nothing` : "Running the rule's checks on today's book. It writes nothing."}</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p> : shown ? <PreviewLines lines={shown.lines} /> : <LoadingRows rows={4} columns={5} />}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-foreground">
            {noGrace.length > 0 && <>{noGrace.length} {noGrace.length === 1 ? "carrier has" : "carriers have"} policies behind but no grace set, so no missed payment is counted for them. <Link href={noGrace.length === 1 ? `${CARRIER_TERMS}/${noGrace[0]}` : CARRIER_TERMS} className="hover:underline">Set one in Carrier terms ›</Link></>}
          </span>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Preview today" on a rule's title line (Check it, and a live rule's primary): opens the preview dialog. A read-only
 * account gets the server's preview instead (?preview=1), since every POST is a write.
 */
export function PreviewTodayButton({ ruleId, readOnly, href, initial, primary = false, graceEvent = true, defaultOpen = false }: { ruleId: string; readOnly: boolean; href: string; initial?: Preview | null; primary?: boolean; graceEvent?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(initial) || (defaultOpen && !readOnly));
  if (readOnly && !initial) return <Link href={href} className={buttonVariants({ variant: primary ? "default" : "outline" })}>Preview today</Link>;
  return (
    <>
      <Button type="button" variant={primary ? "default" : "outline"} onClick={() => setOpen(true)}>Preview today</Button>
      <PreviewDialog open={open} onOpenChange={setOpen} body={readOnly ? null : { action: "preview", rule_id: ruleId }} initial={initial} graceEvent={graceEvent} />
    </>
  );
}
