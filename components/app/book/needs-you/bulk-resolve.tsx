"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";

/** As the API takes them (lib/ingestion/exceptionsRequest.ts RESOLVE_MANY_MAX). */
const BATCH = 50;

export type BulkResolution = "confirm_client" | "not_mine";

const WORDS: Record<BulkResolution, { verb: string; done: string; what: (n: string) => string }> = {
  confirm_client: {
    verb: "Confirm",
    done: "confirmed",
    what: (n) => `Each of the ${n} clients made from the carrier's file becomes a confirmed client, and its policy stays linked. Each is recorded with your name.`,
  },
  not_mine: {
    verb: "Hand on",
    done: "handed on",
    what: (n) => `The ${n} items leave your list and go to operations (a bookkeeper), or to the owner if operations already had them.`,
  },
};

type Run = { state: "ask" } | { state: "running"; done: number } | { state: "stopped"; done: number; failed: Array<{ id: string; error: string }> };

/**
 * Book of business, round 4 (owner 2026-11-02, beyond LA-4.9's one-at-a-time): one answer for a group of items
 * that share it, e.g. a file's 397 "No sale yet" items → "the client is right". A confirm first (it changes
 * hundreds of records), then batches of 50 through POST /api/app/exceptions `resolve_many` with a progress bar;
 * Stop ends after the batch in flight, and what saved stays saved. An item that fails is named, and the rest can
 * be tried again.
 */
export function BulkResolve({ ids, resolution, noun, label, size = "sm", variant = "default" }: { ids: string[]; resolution: BulkResolution; noun: string; label?: string; size?: "sm" | "default"; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<Run>({ state: "ask" });
  const [left, setLeft] = useState<string[]>(ids);
  const stop = useRef(false);
  const words = WORDS[resolution];
  const total = left.length;
  const n = (value: number) => value.toLocaleString("en-US");

  async function go() {
    stop.current = false;
    let done = 0;
    const saved = new Set<string>();
    const failed: Array<{ id: string; error: string }> = [];
    setRun({ state: "running", done: 0 });
    for (let at = 0; at < left.length && !stop.current; at += BATCH) {
      const batch = left.slice(at, at + BATCH);
      try {
        const response = await fetch("/api/app/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve_many", item_ids: batch, resolution }) });
        const data = (await response.json().catch(() => ({}))) as { done?: string[]; failed?: Array<{ id: string; error: string }>; error?: string };
        if (!response.ok && !data.done) throw new Error(data.error ?? "That did not save.");
        for (const id of data.done ?? []) saved.add(id);
        done = saved.size;
        failed.push(...(data.failed ?? []));
      } catch (error) {
        failed.push(...batch.map((id) => ({ id, error: error instanceof Error ? error.message : "That did not save." })));
        stop.current = true;
      }
      setRun({ state: "running", done });
    }
    const unsaved = left.filter((id) => !saved.has(id));
    router.refresh();
    if (saved.size) refreshStepCounts();
    if (!unsaved.length) {
      notify.done(`${n(done)} ${noun} ${words.done}.`);
      setOpen(false);
      setRun({ state: "ask" });
      setLeft([]);
      return;
    }
    setLeft(unsaved);
    setRun({ state: "stopped", done, failed });
  }

  const change = (next: boolean) => {
    if (!next && run.state === "running") { stop.current = true; return; }
    setOpen(next);
    if (!next) setRun({ state: "ask" });
  };

  if (!total && run.state === "ask") return null;
  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={() => { setLeft(left.length ? left : ids); setOpen(true); }}>{label ?? `${words.verb} all ${n(ids.length)}`}</Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent size="sm" showCloseButton={run.state !== "running"}>
          <DialogHeader>
            <DialogTitle>
              {run.state === "ask" ? `${words.verb} ${n(total)} ${noun}?`
                : run.state === "running" ? `${words.verb === "Confirm" ? "Confirming" : "Handing on"}… ${n(run.done)} of ${n(total)}`
                : `Stopped at ${n(run.done)} of ${n(run.done + left.length)}`}
            </DialogTitle>
            <DialogDescription>
              {run.state === "ask" ? words.what(n(total))
                : run.state === "running" ? "Stop ends after the batch being saved; what is saved stays saved."
                : run.failed.length ? `${run.failed[0].error} ${n(run.done)} saved; ${n(left.length)} still wait.` : `${n(run.done)} saved; ${n(left.length)} still wait.`}
            </DialogDescription>
          </DialogHeader>
          {run.state === "running" && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={run.done} aria-label={`${n(run.done)} of ${n(total)}`} className="h-1.5 overflow-hidden rounded-full bg-[var(--border-strong)]">
              <span className="block h-full bg-[var(--primary)] transition-[width] duration-300 ease-out" style={{ width: `${total ? Math.round((run.done / total) * 100) : 0}%` }} />
            </div>
          )}
          <DialogFooter>
            {run.state === "ask" && <><Button type="button" variant="outline" onClick={() => change(false)}>Cancel</Button><Button type="button" onClick={() => void go()}>{`${words.verb} ${n(total)}`}</Button></>}
            {run.state === "running" && <Button type="button" variant="outline" onClick={() => { stop.current = true; }}>Stop</Button>}
            {run.state === "stopped" && <><Button type="button" variant="outline" onClick={() => change(false)}>Close</Button>{left.length > 0 && <Button type="button" onClick={() => void go()}>Try the rest</Button>}</>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
