"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SettingSheet, SheetPart, type HistoryItem } from "@/components/app/settings/money/setting-kit";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { inputControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { StatusChip } from "@/components/ui/status-chip";
import { SIGNAL_LABELS, SIGNALS, type Signal, type Weights } from "@/lib/retention/constants";
import { weightTotal } from "@/lib/retention/settingsHub";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Settings › Retention › Scoring weights as a wide sheet over its tab (docs/design/settings-r8/money-compliance-
 * settings.html §5; it replaces opening /retention-settings/weights, which stays for old links). Each signal is a
 * slider and a number, with the Insurvas weight marked on its track and the saved weight beside it. The preview runs
 * by itself a moment after a change (the server scores today's book with these weights; nothing is written), and
 * Save as version N waits for a preview of these exact weights, as the page always did. Use Insurvas weights asks
 * first. History lists the weight versions, newest first; Put back loads the previous version's weights.
 */
type Preview = { moved: number; up: number; down: number; intoCritical: number; total: number };
export type WeightChange = { from: unknown; to: unknown; by: string; at: string };

const HINT: Partial<Record<Signal, string>> = {
  draft_timing: "money arrives after the draft",
  payment_method: "card, bank draft, direct express",
  policy_age: "early months lapse most",
};
const count = (v: number) => v.toLocaleString("en-US");

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/app/retention/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

/** A weights audit value ({ version, ...weights }) as its version and weights. */
function readSet(value: unknown): { version: number | null; weights: Weights | null } {
  if (!value || typeof value !== "object") return { version: null, weights: null };
  const v = value as Record<string, unknown>;
  const weights = SIGNALS.every((s) => typeof v[s] === "number") ? (Object.fromEntries(SIGNALS.map((s) => [s, v[s] as number])) as Weights) : null;
  return { version: typeof v.version === "number" ? v.version : null, weights };
}

export function WeightsSheet({ weights: saved, version, isPlatform, platformWeights, changes, canEdit, readOnlyWhy, onClose, onDirty }: {
  weights: Weights;
  version: number;
  isPlatform: boolean;
  platformWeights: Weights;
  /** The recorded weight changes ("weights" rows of the hub's change log), newest first. */
  changes: readonly WeightChange[];
  canEdit: boolean;
  readOnlyWhy?: string;
  onClose: () => void;
  /** Tells the board a weight is being changed (its status line says so). */
  onDirty?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [weights, setWeights] = useState<Weights>(saved);
  const [preview, setPreview] = useState<{ for: string; result: Preview } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const total = weightTotal(weights);
  const key = JSON.stringify(weights);
  const dirty = key !== JSON.stringify(saved);
  const previewed = preview?.for === key;
  const changed = SIGNALS.filter((s) => weights[s] !== saved[s]).length;

  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  // The preview runs by itself, a moment after the last change, once the weights add up to 100.
  const asked = useRef(0);
  useEffect(() => {
    if (!canEdit || !dirty || total !== 100) return;
    const ask = ++asked.current;
    const timer = window.setTimeout(() => {
      post({ action: "preview_weights", weights }).then(
        (json) => { if (ask === asked.current) { setPreview({ for: key, result: json.preview as Preview }); setPreviewError(null); } },
        (e: unknown) => { if (ask === asked.current) setPreviewError(e instanceof Error ? e.message : "The preview did not run"); },
      );
    }, 450);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, total, key, weights]);

  const set = (s: Signal, value: number) => { setWeights((cur) => ({ ...cur, [s]: Math.max(0, Math.min(100, Math.round(value) || 0)) })); setError(null); };
  const send = async (body: Record<string, unknown>, done: string) => {
    setBusy(body.action === "reset" ? "reset" : "save");
    setError(null);
    try {
      await post(body);
      notify.done(done);
      setResetting(false);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save");
    } finally {
      setBusy(null);
    }
  };

  const history: HistoryItem[] = changes.slice(0, 6).map((c, i) => {
    const from = readSet(c.from);
    const to = readSet(c.to);
    const moved = to.weights && from.weights ? SIGNALS.filter((s) => to.weights![s] !== from.weights![s]).map((s) => `${SIGNAL_LABELS[s].toLowerCase()} ${from.weights![s]} → ${to.weights![s]}`) : [];
    return {
      key: `${c.at}-${i}`,
      who: c.by,
      at: c.at,
      line: <>Version {to.version ?? "?"}{moved.length ? ` · ${moved.slice(0, 2).join(", ")}${moved.length > 2 ? `, ${moved.length - 2} more` : ""}` : ""}</>,
      onPutBack: i === 0 && canEdit && from.weights ? () => { setWeights(from.weights!); setError(null); } : null,
    };
  });

  const result = previewed ? preview!.result : null;
  return (
    <>
      <LeaveGuard dirty={dirty && busy === null} onDiscard={() => setWeights(saved)} what="the scoring weights" />
      <SettingSheet wide title="Scoring weights" where={<>Retention › Radar · version {version} in use{isPlatform ? ", Insurvas's" : ""}</>} canEdit={canEdit} readOnlyWhy={readOnlyWhy}
        heading="How much each signal counts" said="Points out of 100. The grey mark on each line is the Insurvas weight."
        readValue={<ul className="m-0 list-none p-0">{SIGNALS.map((s) => <li key={s} className="flex justify-between gap-4 border-b border-border py-1.5 last:border-b-0"><span>{SIGNAL_LABELS[s]}</span><span className="tabular-nums">{saved[s]}</span></li>)}</ul>}
        busy={busy !== null} error={error} saveLabel={`Save as version ${version + 1}`} saveDisabled={total !== 100 || !previewed || !dirty}
        onSave={() => void send({ action: "save_weights", weights }, `Saved as version ${version + 1}`)}
        onUseInsurvas={isPlatform ? null : () => setResetting(true)} insurvasLabel="Use Insurvas weights"
        onClose={onClose}
        extra={(
          <>
            {canEdit && (
              <SheetPart title="What this does to your book" said={`Live preview over today's scored policies. Nothing changes until you save. Scores already made keep version ${version}.`}>
                {total !== 100 ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">The weights add up to {total}. They must add up to 100 to preview or save.</p>
                  : !dirty ? <p className="m-0 text-sm text-[var(--muted)]">Move a weight to see how many policies would change band.</p>
                  : previewError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{previewError}</p>
                  : !result ? <p className="m-0 text-sm text-[var(--muted)]" aria-live="polite">Working out the preview…</p>
                  : (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
                        <Tile label="Policies scored" value={count(result.total)} />
                        <Tile label="Change band" value={count(result.moved)} />
                        <Tile label="Move up" value={count(result.up)} rise={result.up > 0} />
                        <Tile label="Newly critical" value={count(result.intoCritical)} rise={result.intoCritical > 0} />
                      </div>
                      <p className="m-0 rounded-[10px] px-3 py-2.5 text-sm text-[var(--body)] shadow-[inset_0_0_0_1px_var(--border)]">
                        <b className="text-[var(--ink)]">{count(result.moved)} {result.moved === 1 ? "policy changes" : "policies change"} band</b>: {count(result.up)} up, {count(result.down)} down. <Link className="font-semibold text-[var(--accent-ink)] hover:underline" href="/app/retention-results">See results ›</Link>
                      </p>
                    </>
                  )}
              </SheetPart>
            )}
          </>
        )}
        history={history} historyHref="/app/settings?history=retention#settings-history" historyEmpty={isPlatform ? "Version 1 · Insurvas weights, never changed." : "No change recorded yet."}>
        {SIGNALS.map((s) => (
          <div key={s} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-3 border-b border-border py-1.5 last:border-b-0 sm:grid-cols-[200px_minmax(0,1fr)_64px_64px]">
            <span className="text-sm text-[var(--ink)]">{SIGNAL_LABELS[s]}{HINT[s] && <span className="block text-xs text-[var(--muted)]">{HINT[s]}</span>}</span>
            <span className="relative hidden sm:block">
              <input type="range" min={0} max={100} step={1} value={weights[s]} aria-label={`${SIGNAL_LABELS[s]} weight`} className="w-full accent-[var(--primary)]" onChange={(e) => set(s, Number(e.target.value))} />
              <span aria-hidden="true" title={`Insurvas weight ${platformWeights[s]}`} className="pointer-events-none absolute -bottom-1 h-2 w-0.5 -translate-x-1/2 rounded bg-[var(--border-strong)]" style={{ left: `${platformWeights[s]}%` }} />
            </span>
            <input aria-label={`${SIGNAL_LABELS[s]} points`} inputMode="numeric" className={cn(inputControl, "h-8 text-right tabular-nums", weights[s] !== saved[s] && "border-[var(--ring-color)]")} value={String(weights[s])} onChange={(e) => set(s, Number(e.target.value.replace(/\D/g, "")))} />
            <span className="hidden text-xs text-[var(--muted)] sm:block">was {saved[s]}</span>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2.5 pt-1 text-sm">
          {total === 100 ? <StatusChip tone="good">Adds up to 100</StatusChip> : <StatusChip tone="danger">{total} · must be 100</StatusChip>}
          <span className="text-xs text-[var(--muted)]">{changed ? `${changed} weight${changed === 1 ? "" : "s"} changed from version ${version}` : `Version ${version}, unchanged`}</span>
        </div>
      </SettingSheet>
      <ConfirmDialog open={resetting} onOpenChange={setResetting} busy={busy === "reset"} destructive={false}
        title="Go back to Insurvas's weights?" description={`They are saved as version ${version + 1} and the book is scored again now. Scores already made keep their version.`}
        confirmLabel="Use Insurvas weights" cancelLabel="Keep mine" onConfirm={() => void send({ action: "reset", section: "weights", confirmation: null }, "Insurvas weights in use")} />
    </>
  );
}

function Tile({ label, value, rise }: { label: string; value: string; rise?: boolean }) {
  return (
    <div className="rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--border)]">
      <span className="block text-xs text-[var(--muted)]">{label}</span>
      <b className={cn("text-base tabular-nums", rise ? "text-[var(--highlight-ink)]" : "text-[var(--ink)]")}>{value}</b>
    </div>
  );
}

