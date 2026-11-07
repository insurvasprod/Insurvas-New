"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { checkboxControl, control, Field } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { DEFAULT_LADDER_SETTINGS, FROM_FLAG, REASON_LABELS, REASON_STEP, REASONS, STEP_LABELS, type Reason } from "@/lib/retention/cases/ladder";
import type { FlaggedWord, LadderRules } from "@/lib/retention/cases/rulesStore";
import { notify } from "@/lib/notify";

/**
 * Settings › Retention › Ladder rules (owner 2026-11-05; docs/retention/SPEC.md): each fact the carrier files
 * bring, the step it puts a policy on, and whether it counts; when a deadline is urgent; after how many tries a
 * client is unreachable. One save; it re-runs the ladder at once.
 */
export function LadderRulesBoard({ rules, canEdit, words }: { rules: LadderRules; canEdit: boolean; words: FlaggedWord[] }) {
  const router = useRouter();
  const scope = useRef<HTMLFormElement>(null);
  const [off, setOff] = useState<Reason[]>(rules.disabled);
  const [urgent, setUrgent] = useState(String(rules.urgentDays));
  const [unreachable, setUnreachable] = useState(String(rules.unreachableAfter));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = off.slice().sort().join() !== rules.disabled.slice().sort().join() || urgent !== String(rules.urgentDays) || unreachable !== String(rules.unreachableAfter);
  const reset = () => { setOff(rules.disabled); setUrgent(String(rules.urgentDays)); setUnreachable(String(rules.unreachableAfter)); setError(null); };

  async function save(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/retention/ladder-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled: off, urgent_days: Number(urgent), unreachable_after: Number(unreachable) }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The rules could not be saved.");
      notify.done("Saved. The cases follow the new rules now.");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The rules could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={scope} className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (dirty && !busy) void save(); }}>
      <LeaveGuard dirty={dirty && !busy && canEdit} scope={scope} onSave={save} onDiscard={reset} what="the ladder rules" />
      {/* The page says what it is (walk 2026-11-05: it opened on a bare table under "Settings › Retention"). */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold text-foreground">Ladder rules</h2>
          <p className="m-0 text-sm text-muted-foreground">Which facts in the carrier files open a Retention case, and on which step. A switched-off fact opens nothing.</p>
        </div>
        <Link href="/app/retention-settings" className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">All Retention settings</Link>
      </div>
      <TableCard>
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>What the files show</th>
              <th className="w-[220px]">Puts the policy on</th>
              <th className="w-[100px] text-right">On</th>
            </tr>
          </thead>
          <tbody>
            {REASONS.map((r) => (
              <tr key={r}>
                <td className="text-foreground">{REASON_LABELS[r]}{r === "payment_date_change" ? <span className="block text-xs text-muted-foreground">opened by a person: no file carries it</span> : null}</td>
                <td className="text-muted-foreground">{STEP_LABELS[REASON_STEP[r]]}</td>
                <td className="text-right">
                  <input type="checkbox" aria-label={`Count ${REASON_LABELS[r]}`} className={checkboxControl} disabled={!canEdit} checked={!off.includes(r)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== r) : [...off, r])} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <section className={`${cardSurface} grid gap-4 p-5 sm:grid-cols-2`} aria-label="Thresholds">
        <Field label="A deadline is urgent within (days)" htmlFor="lr-urgent" hint={`A payment problem this close to its deadline moves up to Pending lapse. Default ${DEFAULT_LADDER_SETTINGS.urgentDays}.`}>
          <input id="lr-urgent" inputMode="numeric" className={control} disabled={!canEdit} value={urgent} onChange={(e) => setUrgent(e.target.value.replace(/\D/g, "").slice(0, 2))} />
        </Field>
        <Field label="Unreachable after (tries)" htmlFor="lr-unreachable" hint={`Calls in a row that reach nobody. Default ${DEFAULT_LADDER_SETTINGS.unreachableAfter}.`}>
          <input id="lr-unreachable" inputMode="numeric" className={control} disabled={!canEdit} value={unreachable} onChange={(e) => setUnreachable(e.target.value.replace(/\D/g, "").slice(0, 2))} />
        </Field>
      </section>
      {/* SPEC §6: the status-word flags per carrier. Insurvas keeps the map (one per carrier), so it is read here. */}
      <TableCard title="Carrier words that count" footer={<span>Insurvas sets these per carrier as it reads their files. Ask support to flag a word your carrier uses.</span>}>
        {words.length === 0 ? (
          <EmptyState title="No carrier words flagged yet" hint="Until one is, the ladder reads the status, the paid-to date and the commission file. A flagged word (a banking problem, a lapse notice, a pending action) adds its own reason." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Carrier</th><th>Their word</th><th className="w-[260px]">Counts as</th></tr></thead>
            <tbody>
              {words.map((w) => (
                <tr key={`${w.carrierName}|${w.word}`}>
                  <td className="text-foreground">{w.carrierName}</td>
                  <td className="text-foreground">&ldquo;{w.word}&rdquo;</td>
                  <td className="text-muted-foreground">{REASON_LABELS[FROM_FLAG[w.flag]]} · {STEP_LABELS[REASON_STEP[FROM_FLAG[w.flag]]]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setOff([]); setUrgent(String(DEFAULT_LADDER_SETTINGS.urgentDays)); setUnreachable(String(DEFAULT_LADDER_SETTINGS.unreachableAfter)); }}>Back to the defaults</Button>
          <Button type="button" variant="outline" disabled={busy || !dirty} onClick={reset}>Discard</Button>
          <Button type="submit" disabled={busy || !dirty || urgent === "" || unreachable === ""}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </form>
  );
}
