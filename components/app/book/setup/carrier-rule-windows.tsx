"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Field, inputControl } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { RULE_SOURCES, RULE_TYPE_LABELS, type RuleSource, type RuleType } from "@/lib/ingestion/carrierRules";
import { fileDay } from "@/lib/ingestion/constants";
import type { DotState } from "@/lib/pipelineRules/carrierCoverageModel";
import { notify } from "@/lib/notify";

const ENDPOINT = "/api/app/carrier-rules";
const SOURCE_SHORT: Record<RuleSource, string> = { carrier_agreement: "Agreement", phone_call: "Phone call", observed: "Observed" };

export type WindowRule = {
  id: string;
  scope: "agency" | "platform";
  windowDays: number | null;
  graceDays: number | null;
  redraftAttempts: number | null;
  redraftIntervalDays: number | null;
  source: string | null;
  notes: string | null;
  effectiveFrom: string;
  verified: boolean;
};

export type WindowHistoryLine = { id: string; effectiveFrom: string; scope: "agency" | "platform"; cleared: boolean; windowDays: number | null; graceDays: number | null; source: string | null; notes: string | null; verifiedAt: string | null; by: string | null; verifiedBy: string | null };

export type WindowRow = {
  type: RuleType;
  state: DotState;
  /** The rule in force today: the agency's own, else Insurvas's. */
  rule: WindowRule | null;
  /** Insurvas's own rule, what "Back to Insurvas's" returns to. */
  insurvas: WindowRule | null;
  /** The agency's own rule dated after today. */
  upcoming: WindowRule | null;
  /** What the missing window costs, in words. */
  cost: string;
  history: WindowHistoryLine[];
};

const d = (n: number | null) => (n === null ? "—" : `${n} d`);
const label = (type: RuleType) => RULE_TYPE_LABELS[type].label;
const sourceWord = (source: string | null) => (source && source in SOURCE_SHORT ? SOURCE_SHORT[source as RuleSource] : source ? source : "Source not said");

function redraftText(rule: WindowRule) {
  if (rule.redraftAttempts === null) return "—";
  const tries = `${rule.redraftAttempts} ${rule.redraftAttempts === 1 ? "try" : "tries"}`;
  return rule.redraftIntervalDays === null || rule.redraftAttempts < 2 ? tries : `${tries} · ${rule.redraftIntervalDays} d apart`;
}

/** Whose value it is: Insurvas's, or yours from a date. */
const whose = (rule: WindowRule) => (rule.scope === "agency" ? `yours, from ${fileDay(rule.effectiveFrom)}` : "Insurvas's");

/** The source with its verified mark; an unverified value keeps its grey "· unverified" wherever it is shown. */
export function SourceChip({ source, verified }: { source: string | null; verified: boolean }) {
  return <StatusChip tone={verified ? "good" : "neutral"} dot>{`${sourceWord(source)} · ${verified ? "verified" : "unverified"}`}</StatusChip>;
}

type Draft = { window: string; grace: string; attempts: string; interval: string; source: RuleSource; from: string; note: string };
const num = (value: string) => (value.trim() === "" ? null : Number(value));
const digits = (value: string) => value.replace(/\D/g, "");

/**
 * A carrier's retention windows (boards 9b, 9c): window, grace, redraft attempts and interval, the source with its
 * verified chip, and Edit. A missing window is a row naming its cost, with Set it; the first is the page's one
 * primary. Edit opens in the row: closes after, grace, redraft, where it's from, from-date, note, and Back to
 * Insurvas's. Each save is a new dated rule (POST /api/app/carrier-rules add_rule); past countdowns keep the rule
 * they used, which the row's history shows. "Mark it verified" asks first (action verify, the agency's own rules).
 */
export function CarrierRuleWindows({ carrierId, carrierName, asOf, readOnly, rows }: { carrierId: string; carrierName: string; asOf: string; readOnly: boolean; rows: WindowRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<RuleType | null>(null);
  const [draft, setDraft] = useState<Draft>({ window: "", grace: "", attempts: "", interval: "", source: "carrier_agreement", from: asOf, note: "" });
  const [busy, setBusy] = useState(false);
  const firstMissing = rows.find((row) => !row.rule)?.type ?? null;

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      setOpen(null);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function start(row: WindowRow) {
    const base = row.rule;
    setDraft({
      window: base?.windowDays?.toString() ?? "", grace: base?.graceDays?.toString() ?? "", attempts: base?.redraftAttempts?.toString() ?? "", interval: base?.redraftIntervalDays?.toString() ?? "",
      source: (base?.scope === "agency" && (RULE_SOURCES as readonly string[]).includes(base.source ?? "") ? base.source : "carrier_agreement") as RuleSource,
      from: asOf, note: "",
    });
    setOpen(row.type);
  }

  function save(row: WindowRow) {
    const from = draft.from || asOf;
    const set = !row.rule;
    void post({
      action: "add_rule", carrier_id: carrierId, rule_type: row.type,
      window_days: num(draft.window), grace_days: num(draft.grace), redraft_attempts: num(draft.attempts), redraft_interval_days: num(draft.interval),
      source: draft.source, notes: draft.note.trim() || null, effective_from: from,
    }, set ? `${label(row.type)} window set from ${fileDay(from)}.` : `${carrierName}: your ${RULE_TYPE_LABELS[row.type].window} applies from ${fileDay(from)}.`);
  }

  async function backToInsurvas(row: WindowRow) {
    const ok = await confirmAction({
      title: "Back to Insurvas's?",
      description: row.insurvas ? `From today ${carrierName} uses Insurvas's ${label(row.type).toLowerCase()} window (${d(row.insurvas.windowDays)}) for your agency. Past countdowns keep the rule they used.` : `Insurvas has no ${label(row.type).toLowerCase()} window for ${carrierName}, so from today it is not set. Past countdowns keep the rule they used.`,
      confirmLabel: "Use Insurvas's",
      cancelLabel: "Keep mine",
      destructive: false,
    });
    if (ok) void post({ action: "clear_override", carrier_id: carrierId, rule_type: row.type }, "Back to Insurvas's rule.");
  }

  async function verify(row: WindowRow) {
    if (!row.rule) return;
    const ok = await confirmAction({
      title: "Mark it verified?",
      description: `"${label(row.type)} · ${d(row.rule.windowDays)}" will show without the unverified mark, recorded as verified by you today.`,
      confirmLabel: "Verify",
      destructive: false,
    });
    if (ok) void post({ action: "verify", rule_id: row.rule.id }, `${label(row.type)} window verified.`);
  }

  const editor = (row: WindowRow) => (
    <div className="grid gap-4 py-2">
      {!readOnly && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <Field className="flex flex-col" label="Closes after" htmlFor={`${row.type}-window`} hint="days from paid-to">
            <input id={`${row.type}-window`} className={`${inputControl} mt-1.5`} inputMode="numeric" value={draft.window} onChange={(e) => setDraft({ ...draft, window: digits(e.target.value) })} />
          </Field>
          <Field className="flex flex-col" label="Grace" htmlFor={`${row.type}-grace`} hint="days">
            <input id={`${row.type}-grace`} className={`${inputControl} mt-1.5`} inputMode="numeric" value={draft.grace} onChange={(e) => setDraft({ ...draft, grace: digits(e.target.value) })} />
          </Field>
          <Field className="flex flex-col" label="Redraft tries" htmlFor={`${row.type}-attempts`}>
            <input id={`${row.type}-attempts`} className={`${inputControl} mt-1.5`} inputMode="numeric" value={draft.attempts} onChange={(e) => setDraft({ ...draft, attempts: digits(e.target.value) })} />
          </Field>
          <Field className="flex flex-col" label="Days apart" htmlFor={`${row.type}-interval`}>
            <input id={`${row.type}-interval`} className={`${inputControl} mt-1.5`} inputMode="numeric" value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: digits(e.target.value) })} />
          </Field>
          <Field className="flex flex-col" label="From" htmlFor={`${row.type}-from`}>
            <input id={`${row.type}-from`} type="date" className={`${inputControl} mt-1.5`} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </Field>
        </div>
      )}
      {!readOnly && (
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <span className="text-label text-[var(--body)]">Where it&apos;s from</span>
            <span role="radiogroup" aria-label="Where it's from" className="mt-1.5 flex flex-wrap gap-2">
              {RULE_SOURCES.map((source) => <ToggleChip key={source} role="radio" selected={draft.source === source} onClick={() => setDraft({ ...draft, source })}>{SOURCE_SHORT[source]}</ToggleChip>)}
            </span>
          </div>
          <Field className="flex flex-col" label="Note" htmlFor={`${row.type}-note`}>
            <input id={`${row.type}-note`} className={`${inputControl} mt-1.5`} maxLength={1000} placeholder="Who confirmed it, and when" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </Field>
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {row.rule?.scope === "agency" && <Button type="button" variant="ghost" disabled={busy} onClick={() => void backToInsurvas(row)}>Back to Insurvas&apos;s</Button>}
          {row.rule?.scope === "agency" && !row.rule.verified && <Button type="button" variant="outline" disabled={busy} onClick={() => void verify(row)}>Mark it verified</Button>}
          <span className="flex-1" />
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
          <Button type="button" disabled={busy || (!draft.window && !draft.grace && !draft.attempts)} onClick={() => save(row)}>Save</Button>
        </div>
      )}
      <div>
        <span className="text-label text-[var(--body)]">History</span>
        {row.history.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">No rule has been saved for this window yet.</p>
        ) : (
          <ul className="mt-1.5 grid gap-1 text-sm">
            {row.history.map((line) => (
              <li key={line.id} className="flex flex-wrap gap-x-3">
                <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{fileDay(line.effectiveFrom)}</span>
                <span className="text-foreground">{line.cleared ? "Back to Insurvas's" : [line.windowDays !== null ? `${line.windowDays} d` : null, line.graceDays !== null ? `grace ${line.graceDays} d` : null, line.source ? sourceWord(line.source).toLowerCase() : null].filter(Boolean).join(" · ") || "—"}</span>
                <span className="text-muted-foreground">{line.scope === "platform" ? "Insurvas" : line.by ?? "your agency"}{line.verifiedAt ? ` · verified ${fileDay(line.verifiedAt)}${line.verifiedBy ? ` by ${line.verifiedBy}` : ""}` : ""}</span>
                {line.notes && <span className="basis-full text-xs text-muted-foreground">{line.notes}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">Past countdowns keep the rule they used.</p>
      </div>
    </div>
  );

  return (
    <TableCard title="Retention windows" description="Days from paid-to">
      <table className="portal-lead-table w-full min-w-[880px] text-left text-sm" data-even="off">
        {/* data-even="off": the cost line of a missing window spans the value columns; even widths would split it. */}
        <thead>
          <tr><th>Window</th><th>Closes after</th><th>Grace</th><th>Redraft</th><th>Source</th><th className="w-[160px] text-right"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const editing = open === row.type;
            return (
              <Fragment key={row.type}>
                <tr>
                  <td className="font-medium text-foreground">{label(row.type)}</td>
                  {row.rule ? (
                    <>
                      <td className="tabular-nums">{row.rule.windowDays === null ? <span className="text-[var(--error-ink)]">Not set</span> : d(row.rule.windowDays)}</td>
                      <td className="tabular-nums">{d(row.rule.graceDays)}</td>
                      <td>{redraftText(row.rule)}</td>
                      <td>
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <SourceChip source={row.rule.source} verified={row.rule.verified} />
                          <span className="text-xs text-muted-foreground">{whose(row.rule)}{row.upcoming ? ` · yours ${d(row.upcoming.windowDays)} from ${fileDay(row.upcoming.effectiveFrom)}` : ""}</span>
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="whitespace-normal">
                      <span className="font-medium text-[var(--error-ink)]">Not set</span>
                      <span className="text-muted-foreground"> · {row.cost}</span>
                      {row.upcoming && <span className="text-muted-foreground"> · yours {d(row.upcoming.windowDays)} from {fileDay(row.upcoming.effectiveFrom)}</span>}
                    </td>
                  )}
                  <td className="text-right">
                    {editing ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(null)}>Close</Button>
                    ) : readOnly ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(row.type)}>History</Button>
                    ) : row.rule ? (
                      <Button type="button" variant="outline" size="sm" disabled={busy || open !== null} onClick={() => start(row)}>Edit</Button>
                    ) : (
                      <Button type="button" variant={row.type === firstMissing ? "default" : "outline"} size="sm" disabled={busy || open !== null} onClick={() => start(row)}>Set it</Button>
                    )}
                  </td>
                </tr>
                {editing && (
                  <tr>
                    <td colSpan={6} className="whitespace-normal">{editor(row)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}
