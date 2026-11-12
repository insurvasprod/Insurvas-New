"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, textareaControl } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/status-chip";
import type { EvaluationRow } from "@/lib/pipelineRules/store";

const ENDPOINT = "/api/app/pipeline-rules";
const OPEN_EVENT = "card-moves:check";

type Verdict = { checked: "right" | "wrong" | null; checkedNote: string | null };

export const leadHref = (line: Pick<EvaluationRow, "leadId">) => (line.leadId ? `/app/leads/${line.leadId}` : null);
export const policyHref = (line: Pick<EvaluationRow, "carrierId" | "policyNumber">) => `/app/policies/carrier/${line.carrierId}/${encodeURIComponent(line.policyNumber)}`;
const LINK = "font-semibold text-[var(--accent-ink)] hover:underline";

/** Opens the check dialog from anywhere on the page (the title line's "Check N one by one"): at a line, or the first not checked. */
export function openCheck(at: string | null = null) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: at }));
}

/** "Check 11 one by one" on the Check it tab's title line (mockup 2·2). */
export function CheckOneByOneButton({ open }: { open: number }) {
  if (open <= 0) return null;
  return <Button type="button" onClick={() => openCheck(null)}>Check {open.toLocaleString("en-US")} one by one</Button>;
}

/**
 * The check dialog (mockup r7 2·4, Dialog lg 560): one would-move at a time — lead, policy, because, card, the note it
 * adds — then Right, or Wrong with an optional reason (the checkedNote the API already keeps). A checked line shows
 * its mark with Undo. Keyboard: R right, W wrong, → skip, ← back. Nothing here moves a card.
 */
export function CheckDialog({ lines, autoOpen = false }: { lines: EvaluationRow[]; autoOpen?: boolean }) {
  const router = useRouter();
  // Overview's "Check them ›" lands here with ?check=1: open on the first line not checked.
  const [open, setOpen] = useState(() => autoOpen && lines.length > 0);
  const [index, setIndex] = useState(() => (autoOpen ? Math.max(0, lines.findIndex((l) => !l.checked)) : 0));
  const [marks, setMarks] = useState<Record<string, Verdict>>({});
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markOf = useCallback((line: EvaluationRow): Verdict => marks[line.id] ?? { checked: line.checked, checkedNote: line.checkedNote }, [marks]);
  const firstOpen = useCallback((after = -1) => {
    const found = lines.findIndex((l, i) => i > after && !markOf(l).checked);
    return found;
  }, [lines, markOf]);

  const start = useCallback((at: string | null) => {
    const i = at ? lines.findIndex((l) => l.id === at) : firstOpen();
    setIndex(i >= 0 ? i : 0);
    setAsking(false);
    setWhy("");
    setError(null);
    setOpen(true);
  }, [lines, firstOpen]);

  useEffect(() => {
    const listener = (event: Event) => start((event as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(OPEN_EVENT, listener);
    return () => window.removeEventListener(OPEN_EVENT, listener);
  }, [start]);

  const line = lines[index] ?? null;
  if (!line) return null;
  const mark = markOf(line);
  const last = index >= lines.length - 1;

  function move(to: number) {
    setIndex(Math.max(0, Math.min(lines.length - 1, to)));
    setAsking(false);
    setWhy("");
    setError(null);
  }

  async function save(verdict: "right" | "wrong" | null, note: string | null) {
    if (!line) return;
    setBusy(true);
    setError(null);
    try {
      const body = verdict === "wrong" ? { action: "check", evaluation_id: line.id, verdict, note: note?.trim() || null } : { action: "check", evaluation_id: line.id, verdict };
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not work.");
      setMarks((current) => ({ ...current, [line.id]: { checked: verdict, checkedNote: verdict === "wrong" ? note?.trim() || null : null } }));
      router.refresh();
      setAsking(false);
      setWhy("");
      // After a verdict, the next line; on the last one it stays, showing its mark.
      if (verdict && !last) move(index + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (busy || (event.target as HTMLElement).closest("textarea, input")) return;
    const key = event.key.toLowerCase();
    if (!mark.checked && !asking && key === "r") { event.preventDefault(); void save("right", null); }
    else if (!mark.checked && !asking && key === "w") { event.preventDefault(); setAsking(true); }
    else if (event.key === "ArrowRight" && !last) { event.preventDefault(); move(index + 1); }
    else if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); move(index - 1); }
  }

  const lead = leadHref(line);
  const summary = `${line.leadName ?? "A lead"} · ${line.policyNumber} · ${line.fromStage ?? "No stage"} → ${line.toStage ?? "the rule's stage"}`;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent size={"lg"} onKeyDown={onKey}>
        <DialogHeader>
          <DialogTitle>Check would-move {index + 1} of {lines.length}</DialogTitle>
          <DialogDescription className="sr-only">Mark what the rule would have done as right or wrong. R right, W wrong, arrow keys to move.</DialogDescription>
        </DialogHeader>

        {asking ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0 text-muted-foreground">{summary}</p>
            <Field label="What's wrong with it?" htmlFor="check-why" hint="Optional. Shown beside the Wrong mark.">
              <textarea id="check-why" autoFocus className={textareaControl} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Client paid by phone; the carrier file is behind." />
            </Field>
          </div>
        ) : mark.checked ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0 text-muted-foreground">{summary}</p>
            <div><StatusChip tone={mark.checked === "right" ? "good" : "danger"}>{mark.checked === "right" ? "Right" : `Wrong${mark.checkedNote ? ` · ${mark.checkedNote}` : ""}`}</StatusChip></div>
          </div>
        ) : (
          <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">Lead</dt>
            <dd className="m-0">{lead ? <Link href={lead} className={LINK}>{line.leadName ?? "A lead"}</Link> : line.leadName ?? "No lead linked"}</dd>
            <dt className="text-muted-foreground">Policy</dt>
            <dd className="m-0"><Link href={policyHref(line)} className={LINK}>{line.policyNumber}</Link>{line.carrierName ? ` · ${line.carrierName}` : ""}</dd>
            <dt className="text-muted-foreground">Because</dt>
            <dd className="m-0 text-foreground">{line.because ?? "—"}</dd>
            <dt className="text-muted-foreground">Card</dt>
            <dd className="m-0 text-foreground">{line.fromStage ?? "No stage"} → <b>{line.toStage ?? "the rule's stage"}</b></dd>
            {line.note && <><dt className="text-muted-foreground">Note it adds</dt><dd className="m-0 text-muted-foreground">{line.note}</dd></>}
          </dl>
        )}

        {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}

        <DialogFooter className="sm:justify-between">
          {asking ? (
            <>
              <span />
              <span className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setAsking(false)}>Cancel</Button>
                <Button type="button" variant="destructive" disabled={busy} onClick={() => void save("wrong", why)}>{last ? "Mark it wrong" : "Mark it wrong and next ›"}</Button>
              </span>
            </>
          ) : (
            <>
              <span className="flex gap-2">
                <Button type="button" variant="ghost" disabled={busy || index === 0} onClick={() => move(index - 1)}>‹ Back</Button>
                {!mark.checked && <Button type="button" variant="ghost" disabled={busy || last} onClick={() => move(index + 1)}>Skip ›</Button>}
              </span>
              <span className="flex flex-col-reverse gap-2 sm:flex-row">
                {mark.checked ? (
                  <>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void save(null, null)}>Undo</Button>
                    {last ? <Button type="button" onClick={() => setOpen(false)}>Done</Button> : <Button type="button" disabled={busy} onClick={() => move(index + 1)}>Next ›</Button>}
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setAsking(true)}>Wrong</Button>
                    <Button type="button" disabled={busy} onClick={() => void save("right", null)}>Right</Button>
                  </>
                )}
              </span>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
