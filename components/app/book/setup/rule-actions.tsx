"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { checkboxControl } from "@/components/ui/field";
import type { RuleMode } from "@/lib/pipelineRules/rules";
import { notify } from "@/lib/notify";

const ENDPOINT = "/api/app/pipeline-rules";

/**
 * A rule's header actions (boards BobE7, BobE8): Duplicate, Turn off / Turn on, and the mode — Start the
 * forecast (a draft), Switch to live (asks first; past would-moves are not replayed unless ticked), Back
 * to forecast (a live rule). On/off and the mode are not a new version.
 */
export function RuleActions({ ruleId, name, mode, enabled, forecast, readOnly }: { ruleId: string; name: string; mode: RuleMode; enabled: boolean; forecast: { days: number; wouldMoves: number; right: number; wrong: number }; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [qualify, setQualify] = useState<number | null>(null);
  const [replay, setReplay] = useState(false);

  async function call(body: Record<string, unknown>) {
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "That did not work.");
    return data;
  }

  async function act(body: Record<string, unknown>, done: string, after?: (data: Record<string, unknown>) => void) {
    setBusy(true);
    try {
      const data = await call(body);
      notify.done(done);
      if (after) after(data);
      else router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function askLive() {
    setReplay(false);
    setQualify(null);
    setAsking(true);
    try {
      const data = await call({ action: "preview", rule_id: ruleId, as_live: true });
      setQualify(Number((data.counts as Record<string, number> | undefined)?.move ?? 0));
    } catch {
      setQualify(null);
    }
  }

  if (readOnly) return null;
  return (
    <>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void act({ action: "duplicate", rule_id: ruleId }, "Copied as a new rule, in forecast.", (data) => router.push(`/app/book-setup/pipeline-rules/${data.id}`))}>Duplicate</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void act({ action: "set_enabled", rule_id: ruleId, enabled: !enabled }, enabled ? `“${name}” is off. It records nothing until it is on again.` : `“${name}” is on again.`)}>{enabled ? "Turn off" : "Turn on"}</Button>
      {mode === "draft" && <Button type="button" disabled={busy} onClick={() => void act({ action: "set_mode", rule_id: ruleId, mode: "forecast" }, `“${name}” is in forecast: it records what it would do.`)}>Start the forecast</Button>}
      {mode === "forecast" && <Button type="button" disabled={busy || !enabled} title={enabled ? undefined : "Turn the rule on first"} onClick={() => void askLive()}>Switch to live</Button>}
      {mode === "live" && <Button type="button" variant="outline" disabled={busy} onClick={() => void act({ action: "set_mode", rule_id: ruleId, mode: "forecast" }, `“${name}” is back in forecast. It moves nothing.`)}>Back to forecast</Button>}

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        busy={busy}
        destructive={false}
        title={`Switch “${name}” to live?`}
        description="From now on it moves cards and adds notes. Past would-moves are not replayed unless you tick below."
        confirmLabel="Switch to live"
        cancelLabel="Not yet"
        onConfirm={() => void act({ action: "set_mode", rule_id: ruleId, mode: "live", replay }, `“${name}” is live.`, (data) => { setAsking(false); if (replay) notify.done(`${Number(data.moved ?? 0)} ${Number(data.moved ?? 0) === 1 ? "card" : "cards"} moved now.`); router.refresh(); })}
      >
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Forecast</dt><dd className="m-0">{forecast.days} days · {forecast.wouldMoves} would-moves</dd>
          <dt className="text-muted-foreground">You checked</dt><dd className="m-0">{forecast.right} right · {forecast.wrong} wrong</dd>
        </dl>
        <label className="mt-3 flex items-center gap-2">
          <input type="checkbox" className={checkboxControl} checked={replay} disabled={!qualify} onChange={(e) => setReplay(e.target.checked)} />
          {qualify === null ? "Counting the cards that qualify right now" : qualify === 0 ? "No card qualifies right now" : `Also move the ${qualify} ${qualify === 1 ? "card" : "cards"} that qualify right now`}
        </label>
      </ConfirmDialog>
    </>
  );
}
