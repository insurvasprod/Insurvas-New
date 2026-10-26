"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { InfoTip } from "@/components/ui/info-tip";
import { TableCard } from "@/components/ui/table-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { KeyValues, st } from "@/components/app/settings/primitives";
import { ImportStepper } from "@/components/app/import-stepper";
import { normalizeImportState, parseCsv } from "@/lib/agentTemplates/csv";
import {
  formatCents,
  IMPORT_CSV_KEY,
  perUnitCents,
  reviewOutcome,
  type BucketCounts,
  type BucketRows,
  type DncBreakdown,
  type ReviewBucket,
} from "@/lib/agentTemplates/importReviewModel";
import { cn } from "@/lib/utils";

type Outcome = "ready" | "duplicate_in_file" | "duplicate_existing" | "dnc" | "litigator" | "invalid_phone" | "unreadable";
type Row = { rowNumber: number; name: string; phone: string | null; state: string | null; outcome: Outcome; detail: string | null };
export type ReviewPlan = {
  batchId: string;
  fileName: string | null;
  totalRows: number;
  buckets: BucketCounts;
  /** Row numbers per bucket; null for a plan staged before they were recorded. */
  rows: BucketRows | null;
  rowDetails: Record<string, string>;
  dncBreakdown: DncBreakdown;
  /** The older bounded sample, shown only when `rows` is null. */
  samples: Record<Outcome, Row[]>;
  campaignName: string | null;
  campaignStatus: string | null;
  vendorName: string | null;
  costCents: number | null;
  recordsPurchased: number | null;
  /** The agency's licensed states, as the lead lists count them; null when none are recorded. */
  licensedStates?: string[] | null;
  /** The file's column that carries the state (normalized header); null when none is mapped. */
  stateHeader?: string | null;
  /** New leads with no state: imported, never served until a state is added (LA-2.4-8). */
  noState?: number[] | null;
};

type Decision = "existing" | "infile" | "dnc" | null;

/**
 * Module 2 §6 step ④–⑧ · the decision screen.
 *
 * Every check is one row of the validation table, and every row that carries a choice opens to
 * show it. The order is deliberate: what will land first, then who you already have, then what
 * cannot legally be dialled, then what was never a usable row.
 */
const CHECKS: Array<{ bucket: ReviewBucket; outcome: Outcome; label: string; blurb: string; decision: Decision }> = [
  { bucket: "ready", outcome: "ready", label: "Clean and new", decision: null, blurb: "Clean, scrubbed, and not already in your leads. These are imported." },
  { bucket: "duplicate_existing", outcome: "duplicate_existing", label: "Already one of your leads (same phone)", decision: "existing", blurb: "The number matches a lead you already have. Adding the campaign keeps one lead; anyone already worked is not put back in the dialer." },
  { bucket: "duplicate_in_file", outcome: "duplicate_in_file", label: "Repeated inside this file", decision: "infile", blurb: "The same number appears more than once. The first is imported; every repeat is left out and recorded against the campaign for a vendor credit — the vendor billed the same person twice." },
  { bucket: "dnc_tenant", outcome: "dnc", label: "On your suppression list", decision: "dnc", blurb: "The number is on your own do-not-call list." },
  { bucket: "dnc_registry", outcome: "dnc", label: "DNC registry match", decision: "dnc", blurb: "The number matched the do-not-call registry your scrub vendor checks." },
  { bucket: "dnc", outcome: "dnc", label: "On a do-not-call list", decision: "dnc", blurb: "Checked before the source of a do-not-call match was recorded: your own list or the registry." },
  { bucket: "litigator", outcome: "litigator", label: "TCPA litigator", decision: null, blurb: "Never importable and never dialable, under any setting. Recorded as evidence so you can claim the money back from the vendor." },
  { bucket: "invalid_phone", outcome: "invalid_phone", label: "Phone failed validation", decision: null, blurb: "Nothing to dial, so these are left out. A number the scrub vendor reports as not real is recorded against the campaign for a vendor credit." },
  { bucket: "unreadable", outcome: "unreadable", label: "Unreadable", decision: null, blurb: "These could not be read, so they cannot be imported. Fix them in the file and upload it again." },
];

const LIST_PAGE = 10;

const money = (cents: number | null) => (cents === null ? "—" : formatCents(Math.round(cents)));

/** The parser's header normalization (lib/agentTemplates/csv.ts), so a mapped header is found again. */
const normalizedHeader = (value: string) => value.replace(/^\uFEFF/, "").trim().toLocaleLowerCase();

export function ImportReviewWorkspace({ plan, csv }: { plan: ReviewPlan; csv: string }) {
  const router = useRouter();
  const [duplicatesInFile, setDuplicatesInFile] = useState<"first" | "skip">("first");
  const [existingLeads, setExistingLeads] = useState<"attach" | "skip">("attach");
  const [dnc, setDnc] = useState<"exclude" | "suppress">("exclude");
  const [addSpend, setAddSpend] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [rowsFor, setRowsFor] = useState<(typeof CHECKS)[number] | "no-state" | null>(null);
  const [listing, setListing] = useState<Partial<Record<ReviewBucket, number>>>({});
  const [noStateShown, setNoStateShown] = useState(0);
  const noState = plan.noState ?? [];

  const counts = plan.buckets;
  const campaignLabel = plan.campaignName ?? "this campaign";

  /**
   * What will actually be written, given the current choices.
   *
   * Recomputed as the person changes their mind, because a number that moves when you pick an
   * option is the only way to understand what the option does. `reviewOutcome` adds up what is
   * left out from the buckets themselves, so the footer's "every row accounted for" is a check.
   */
  const outcome = useMemo(
    () => reviewOutcome(counts, plan.dncBreakdown, { duplicatesInFile, existingLeads, dnc }),
    [counts, plan.dncBreakdown, duplicatesInFile, existingLeads, dnc],
  );
  const willImport = outcome.willImport;
  const accountedFor = outcome.fresh + outcome.added + outcome.leftOut === plan.totalRows;

  // The artboard's four buckets, folded from the checks below, so the tiles and the table can
  // never disagree.
  const accepted = counts.ready;
  const duplicates = counts.duplicate_existing + counts.duplicate_in_file;
  const suppressed = counts.dnc_tenant + counts.dnc_registry + counts.dnc + counts.litigator;
  const invalid = counts.invalid_phone + counts.unreadable;
  const fourSum = accepted + duplicates + suppressed + invalid;
  const pct = (count: number) => (plan.totalRows > 0 ? `${((count / plan.totalRows) * 100).toFixed(1)}%` : undefined);

  const perAccepted = perUnitCents(plan.costCents, accepted);
  const perDialable = perUnitCents(plan.costCents, outcome.dialable);

  // The file in this tab, parsed once: when somebody asks to see a list, or to find the rows that are
  // outside the agency's licensed states.
  const anyListing = Object.keys(listing).length > 0 || noStateShown > 0;
  const territory = plan.licensedStates && plan.licensedStates.length > 0 && plan.stateHeader && plan.rows?.ready ? plan.licensedStates : null;
  const parsed = useMemo(() => {
    if (!anyListing && !territory) return null;
    try { return parseCsv(csv); } catch { return null; }
  }, [anyListing, territory, csv]);

  /**
   * New leads in states nobody here is licensed in. They import — the file is what it is — and no
   * licensed agent can sell to them, so their share of the cost is a loss. Not a vendor credit (user
   * decision): the vendor sold what was ordered. Counted over the rows imported as NEW leads only;
   * people you already had are already on your books.
   */
  const offTerritory = useMemo(() => {
    if (!territory || !parsed || !plan.stateHeader || !plan.rows?.ready) return null;
    const column = (parsed[0] ?? []).findIndex((header) => normalizedHeader(header) === plan.stateHeader);
    if (column < 0) return null;
    const licensed = new Set(territory);
    const byState = new Map<string, number>();
    for (const rowNumber of plan.rows.ready) {
      // Read as the importer stores it: "Tennessee" is TN.
      const state = normalizeImportState(parsed[rowNumber - 1]?.[column] ?? "");
      if (state && !licensed.has(state)) byState.set(state, (byState.get(state) ?? 0) + 1);
    }
    const rows = [...byState.values()].reduce((sum, n) => sum + n, 0);
    const states = [...byState.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([state]) => state);
    return { rows, states };
  }, [territory, parsed, plan.stateHeader, plan.rows]);
  const offTerritoryCents = offTerritory && perDialable !== null ? perDialable * offTerritory.rows : null;

  function openRows(check: (typeof CHECKS)[number]) {
    setRowsFor(check);
    setListing((current) => ({ ...current, [check.bucket]: current[check.bucket] ?? LIST_PAGE }));
  }

  function openNoState() {
    setRowsFor("no-state");
    setNoStateShown((shown) => shown || LIST_PAGE);
  }

  function noStateTable() {
    if (!parsed) return <p className="m-0 text-xs text-[var(--error-ink)]">The file in this tab could not be read to list these rows.</p>;
    return <TableCard className="min-w-0 overflow-x-auto">
      <table className={st.table}>
        <thead><tr className={st.headRow}><th scope="col" className={st.th}>Row</th>{(parsed[0] ?? []).slice(0, 4).map((header, index) => <th scope="col" key={`${header}-${index}`} className={st.th}>{header}</th>)}</tr></thead>
        <tbody>{noState.slice(0, noStateShown).map((rowNumber) => <tr key={rowNumber}>
          <td className={cn(st.td, "tabular-nums")}>{rowNumber}</td>
          {(parsed[0] ?? []).slice(0, 4).map((_, index) => <td key={index} className={cn(st.td, "whitespace-nowrap")}>{parsed[rowNumber - 1]?.[index] ?? ""}</td>)}
        </tr>)}</tbody>
      </table>
      {noStateShown < noState.length && <Button type="button" variant="ghost" size="sm" className="m-2" onClick={() => setNoStateShown((shown) => shown + LIST_PAGE)}>Show {Math.min(LIST_PAGE, noState.length - noStateShown)} more</Button>}
    </TableCard>;
  }

  async function commit() {
    setCommitting(true);
    try {
      const response = await fetch("/api/app/leads/import/preflight", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: plan.batchId,
          csv,
          decisions: { duplicates_in_file: duplicatesInFile, existing_leads: existingLeads, dnc },
          add_to_campaign_spend: addSpend && plan.costCents !== null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not import these leads");
        // Already imported — elsewhere, or by a second press. The page shows that state.
        if (response.status === 409) router.refresh();
        return;
      }
      const summary = body.summary as { imported: number; attachedToExisting: number; suppressed: number; rejectionsRecorded: number; servable: boolean; campaignStatus: string | null; spendAddedCents: number; certificatesFiled?: number; noState?: number; warning?: string | null };
      const counted =
        `${summary.imported.toLocaleString()} imported`
        + (summary.attachedToExisting ? ` · ${summary.attachedToExisting.toLocaleString()} added to people you already had` : "")
        + (summary.suppressed ? ` · ${summary.suppressed.toLocaleString()} imported and suppressed` : "")
        + (summary.rejectionsRecorded ? ` · ${summary.rejectionsRecorded.toLocaleString()} recorded for a vendor credit` : "")
        + (summary.certificatesFiled ? ` · ${summary.certificatesFiled.toLocaleString()} consent certificate${summary.certificatesFiled === 1 ? "" : "s"} filed` : "");
      // Said after the commit as well as before it: these leads are in, and will not be called yet.
      const followUps = [summary.noState ? `${summary.noState.toLocaleString()} new lead${summary.noState === 1 ? " has" : "s have"} no state and will not be dialled until one is added.` : null, summary.warning ?? null].filter(Boolean).join(" ");
      const spend = [summary.spendAddedCents > 0 ? `${formatCents(summary.spendAddedCents)} added to ${campaignLabel}'s spend.` : null, followUps || null].filter(Boolean).join(" ") || undefined;
      if (summary.servable || summary.imported + summary.attachedToExisting === 0) notify.done(counted, spend ? { detail: spend } : undefined);
      else
        notify.warn(counted, {
          detail: `${spend ? `${spend} ` : ""}${summary.campaignStatus && summary.campaignStatus !== "active"
            ? `${campaignLabel} is ${summary.campaignStatus}, so the dialer will not serve these leads until it is active.`
            : summary.warning ? "" : "The campaign could not be marked as scrubbed, so the dialer will not serve these yet. Mark it on Vendors & campaigns, or re-run the import."}`.trim(),
        });
      try { sessionStorage.removeItem(`${IMPORT_CSV_KEY}:${plan.batchId}`); } catch { /* the tab keeps it until it closes */ }
      router.push(typeof body.redirect === "string" ? body.redirect : "/app/leads");
    } catch {
      notify.fail("The import could not be confirmed. You can retry safely.");
    } finally {
      setCommitting(false);
    }
  }

  const checks = CHECKS.filter((check) => check.bucket !== "dnc" || counts.dnc > 0);

  function listTable(bucket: ReviewBucket, outcomeKey: Outcome) {
    const numbers = plan.rows?.[bucket];
    if (!numbers) {
      // A plan from before row numbers were recorded: its bounded sample is all there is.
      const samples = plan.samples[outcomeKey] ?? [];
      return <TableCard className="min-w-0">
        <table className={st.table}>
          <thead><tr className={st.headRow}>{["Row", "Name", "Phone", "State", "Why"].map((head) => <th scope="col" key={head} className={st.th}>{head}</th>)}</tr></thead>
          <tbody>{samples.map((row) => <tr key={`${bucket}-${row.rowNumber}`}>
            <td className={cn(st.td, "tabular-nums")}>{row.rowNumber}</td><td className={st.td}>{row.name}</td>
            <td className={cn(st.td, "tabular-nums")}>{row.phone ?? "—"}</td><td className={st.td}>{row.state ?? "—"}</td>
            <td className={st.td}>{row.detail ?? "Ready"}</td>
          </tr>)}</tbody>
        </table>
        <p className="px-3 py-2 text-xs leading-[1.5] text-[var(--muted)]">Showing the first {samples.length} of {(counts[bucket] ?? 0).toLocaleString()}. Upload the file again to list every row.</p>
      </TableCard>;
    }
    if (!parsed) return <p className="text-sm text-[var(--error-ink)]">The file in this tab could not be read to list these rows.</p>;
    const headers = parsed[0] ?? [];
    const shown = numbers.slice(0, listing[bucket] ?? LIST_PAGE);
    const withWhy = bucket === "unreadable" || bucket === "invalid_phone";
    return <TableCard className="min-w-0">
      <div className="min-w-0 overflow-x-auto">
        <table className={st.table}>
          <thead><tr className={st.headRow}>
            <th scope="col" className={st.th}>Row</th>
            {withWhy && <th scope="col" className={st.th}>Why</th>}
            {headers.map((header, index) => <th scope="col" key={`${header}-${index}`} className={st.th}>{header}</th>)}
          </tr></thead>
          <tbody>{shown.map((rowNumber) => {
            const cells = parsed[rowNumber - 1] ?? [];
            return <tr key={rowNumber}>
              <td className={cn(st.td, "tabular-nums")}>{rowNumber}</td>
              {withWhy && <td className={cn(st.td, "min-w-[220px]")}>{plan.rowDetails[String(rowNumber)] ?? "—"}</td>}
              {headers.map((_, index) => <td key={index} className={cn(st.td, "whitespace-nowrap")}>{cells[index] ?? ""}</td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2 text-xs leading-[1.5] text-[var(--muted)]">
        <span className="tabular-nums">Showing {shown.length.toLocaleString()} of {numbers.length.toLocaleString()} · read from the file in this tab</span>
        {shown.length < numbers.length && <Button type="button" variant="ghost" size="sm" onClick={() => setListing((current) => ({ ...current, [bucket]: (current[bucket] ?? LIST_PAGE) + LIST_PAGE }))}>Show {Math.min(LIST_PAGE, numbers.length - shown.length)} more</Button>}
      </div>
    </TableCard>;
  }

  /**
   * A choice, inside the row it decides (2026-10-26, owner: "put it inside the line … less
   * scrolling"): a two-option switch under the row's explanation, with one line saying what the
   * chosen option does. Real radio inputs, so it reads and keys like the fieldset it replaced.
   */
  function choiceSwitch(decision: Exclude<Decision, null>) {
    const options = {
      existing: [
        { value: "attach", label: "Add the campaign", help: "One lead, with this vendor recorded too, so the cost is attributed. Nobody already worked goes back in the dialer." },
        { value: "skip", label: "Skip them", help: "Ignore these rows. Their cost is not attributed anywhere." },
      ],
      infile: [
        { value: "first", label: "Keep the first", help: "One lead per number; the repeats are dropped." },
        { value: "skip", label: "Skip every repeat", help: "Same result for the repeats, as an explicit choice." },
      ],
      // Said plainly, because the missing option is the one people look for.
      dnc: [
        { value: "exclude", label: "Leave them out", help: "Not imported. They stay on the vendor credit claim. There is no option to dial these." },
        { value: "suppress", label: "Import and suppress", help: "Keep the record and add the number to your do-not-call list for good. There is no option to dial these." },
      ],
    }[decision];
    const value = decision === "existing" ? existingLeads : decision === "infile" ? duplicatesInFile : dnc;
    const pick = (next: string) => {
      if (decision === "existing") setExistingLeads(next as typeof existingLeads);
      else if (decision === "infile") setDuplicatesInFile(next as typeof duplicatesInFile);
      else setDnc(next as typeof dnc);
    };
    const chosen = options.find((option) => option.value === value) ?? options[0];
    return <fieldset className="m-0 mt-2 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="sr-only">What to do with these rows</legend>
      <span className="inline-flex w-fit rounded-full border border-[var(--border)] bg-[var(--surface-alt)] p-0.5">
        {options.map((option) => <label key={option.value} className={cn(
          "cursor-pointer rounded-full px-3 py-1 text-xs leading-[1.5] font-semibold whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring-color)]",
          value === option.value ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
        )}>
          <input type="radio" className="sr-only" name={`choice-${decision}`} value={option.value} checked={value === option.value} onChange={() => pick(option.value)} />
          {option.label}
        </label>)}
      </span>
      <span className="text-xs leading-[1.5] text-[var(--body)]">{chosen.help}</span>
    </fieldset>;
  }

  const description = [plan.fileName ?? "File name not recorded", plan.vendorName, plan.campaignName].filter(Boolean).join(" · ");
  // 2026-10-26 redesign (canvas M2 · Vendors, "Import, steps 3–4"): the checks are a short list with
  // their counts, each choice inside the row it decides; the cost and the one Import button sit in a
  // column beside them; a check's rows open in a side panel instead of a wide table inside the list.
  const found = checks.filter((check) => (counts[check.bucket] ?? 0) > 0);
  const none = checks.filter((check) => (counts[check.bucket] ?? 0) === 0);
  const card = "m-glass min-w-0 rounded-xl border border-border";

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader
      title="Import a list"
      description={description}
      actions={<Button type="button" variant="outline" onClick={() => router.push("/app/import")}>Start over</Button>}
    />

    <ImportStepper current={committing ? 4 : 3} />

    <StatStrip label="Import totals">
      <StatTile label="Rows" value={plan.totalRows.toLocaleString()} footnote={fourSum === plan.totalRows ? "every row counted below" : `${fourSum.toLocaleString()} counted below`} />
      <StatTile label="Accepted" value={accepted.toLocaleString()} valueTone="good" footnote={pct(accepted)} reserveFootnote />
      <StatTile label="Duplicates" value={duplicates.toLocaleString()} valueTone="warning" footnote={pct(duplicates)} reserveFootnote />
      <StatTile label="Suppressed" value={suppressed.toLocaleString()} valueTone="info" footnote={pct(suppressed)} reserveFootnote />
      <StatTile label="Invalid" value={invalid.toLocaleString()} valueTone="danger" footnote={pct(invalid)} reserveFootnote />
      <StatTile label="Cost per accepted" value={plan.costCents === null ? "—" : money(perAccepted)} footnote={plan.costCents === null ? "no batch cost entered" : `${formatCents(plan.costCents)} batch`} />
    </StatStrip>

    {fourSum !== plan.totalRows && <Alert tone="warning">
      The four counts add up to <span className="tabular-nums">{fourSum.toLocaleString()}</span>, not the file&rsquo;s <span className="tabular-nums">{plan.totalRows.toLocaleString()}</span> rows.
    </Alert>}

    {/* LA-2.4-8: flagged before the commit, not discovered on the lead list afterwards. */}
    {noState.length > 0 && <Alert tone="warning" action={<Button type="button" variant="ghost" size="sm" onClick={() => openNoState()}>View rows</Button>}>
      {noState.length.toLocaleString()} new {noState.length === 1 ? "lead has" : "leads have"} no state, so the dialer will not call {noState.length === 1 ? "it" : "them"} until one is added.
    </Alert>}

    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <section aria-labelledby="every-row" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 id="every-row" className="m-0 text-base font-semibold tracking-[-0.015em]">What we found</h2>
          {accountedFor ? <StatusChip dot={false} tone="good">every row accounted for</StatusChip> : <StatusChip dot={false} tone="warning">rows do not add up</StatusChip>}
        </div>
        <ul className="m-0 list-none p-0">
          {found.map((check) => {
            const count = counts[check.bucket] ?? 0;
            const share = plan.totalRows > 0 ? (count / plan.totalRows) * 100 : 0;
            // One switch per decision: the do-not-call rows share one, on the first of them.
            const decision = check.decision && found.find((item) => item.decision === check.decision) === check ? check.decision : null;
            return <li key={check.bucket} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-[var(--border)] px-5 py-3.5">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", CHECK_DOT[check.bucket])} />
              <span className="min-w-0 flex-1 basis-[240px]">
                <strong className="block text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">{check.label}</strong>
                <span className="mt-0.5 block text-xs leading-[1.5] text-[var(--muted)]">{check.blurb}</span>
                {decision && choiceSwitch(decision)}
              </span>
              <span className="w-14 text-right text-sm font-semibold tabular-nums text-[var(--ink)]">{count.toLocaleString()}</span>
              <span className="hidden w-24 sm:block" aria-hidden>
                <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className={cn("block h-full rounded-full", CHECK_DOT[check.bucket])} style={{ width: `${Math.max(2, share)}%` }} /></span>
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => openRows(check)}>View rows</Button>
            </li>;
          })}
        </ul>
        {none.length > 0 && <p className="m-0 border-t border-[var(--border)] px-5 py-3 text-xs leading-[1.5] text-[var(--muted)]">
          Also checked, none found: {none.map((check) => check.label).join(" · ")}.
        </p>}
        <p className="m-0 border-t border-[var(--border-strong)] px-5 py-3 text-sm font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">
          {outcome.fresh.toLocaleString()} new · {outcome.added.toLocaleString()} added to existing · {outcome.leftOut.toLocaleString()} left out <span className="font-normal text-[var(--muted)]">of {plan.totalRows.toLocaleString()} rows</span>
        </p>
      </section>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--top-bar-h)+16px)]">
        <section aria-labelledby="cost-allocation" className={cn(card, "p-5")}>
          <h2 id="cost-allocation" className="mb-3 text-base font-semibold tracking-[-0.015em]">Cost</h2>
          <KeyValues items={[
            { label: "Batch cost", value: plan.costCents === null ? "Not entered" : formatCents(plan.costCents) },
            { label: "Accepted leads", value: accepted.toLocaleString() },
            { label: "Cost per accepted", value: money(perAccepted) },
            {
              label: <>Effective per dialable<InfoTip className="ml-1" label="What effective per dialable means">
                Batch cost ÷ rows that will be one of your leads and are not suppressed: new leads plus people you already have who get this campaign added. It moves with your choices.
              </InfoTip></>,
              value: money(perDialable),
            },
            ...(offTerritory
              ? [{
                  label: <>Outside your licensed states<InfoTip className="ml-1" label="What outside your licensed states means">
                    New leads in this file whose state is not one your members are licensed in (Team &amp; access). They import, and nobody here can sell to them. Costed at the effective per dialable; a loss, not a vendor credit.
                  </InfoTip></>,
                  value: `${offTerritory.rows.toLocaleString()} ${offTerritory.rows === 1 ? "row" : "rows"}${offTerritoryCents !== null && offTerritory.rows > 0 ? ` · ${money(offTerritoryCents)}` : ""}`,
                  tone: offTerritory.rows > 0 ? ("warning" as const) : undefined,
                }]
              : []),
          ]} />
          {offTerritory && offTerritory.rows > 0 && (
            <p className="mt-3 text-xs leading-[1.5] text-[var(--warning-ink)]">
              In {offTerritory.states.slice(0, 4).join(", ")}{offTerritory.states.length > 4 ? ` and ${offTerritory.states.length - 4} more` : ""}, outside your {plan.licensedStates?.length ?? 0} licensed states.
            </p>
          )}
          <label htmlFor="add-spend" className={cn("mt-4 flex gap-2.5 border-t border-[var(--border)] pt-4", plan.costCents === null ? "cursor-not-allowed" : "cursor-pointer")}>
            <input id="add-spend" type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--primary)]" checked={addSpend && plan.costCents !== null} disabled={plan.costCents === null} onChange={(event) => setAddSpend(event.target.checked)} />
            <span className="min-w-0">
              <strong className="block text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">Add to {campaignLabel}’s spend</strong>
              <span className="block text-xs leading-[1.5] text-[var(--muted)]">
                {plan.costCents === null
                  ? "No batch cost was entered on the upload step."
                  : `Adds ${formatCents(plan.costCents)} and ${(plan.recordsPurchased ?? plan.totalRows).toLocaleString()} rows purchased to the campaign’s totals. Untick it if the campaign already includes this file’s cost.`}
              </span>
            </span>
          </label>
        </section>

        <section aria-label="Import" className={cn(card, "flex flex-col gap-3 p-5")}>
          <Button type="button" className="w-full" disabled={committing || willImport === 0} onClick={() => void commit()}>
            {committing ? "Importing…" : `Import ${willImport.toLocaleString()} lead${willImport === 1 ? "" : "s"}`}
          </Button>
          <p className="m-0 text-center text-xs leading-[1.5] text-[var(--muted)]">
            {willImport === 0 ? "Nothing in this file will be imported with these choices." : "Nothing has been written until you press this."}
          </p>
        </section>
      </div>
    </div>

    {/* A check's rows, beside the page: the file's own columns are wide, and the list stays readable. */}
    {rowsFor && <DetailPanel
      mode="overlay"
      title={rowsFor === "no-state" ? "New leads with no state" : rowsFor.label}
      subtitle={rowsFor === "no-state" ? `${noState.length.toLocaleString()} rows` : `${(counts[rowsFor.bucket] ?? 0).toLocaleString()} rows`}
      onClose={() => setRowsFor(null)}
      className="lg:w-[min(960px,calc(100vw-120px))]"
      bodyClassName="flex flex-col gap-4 p-5"
    >
      {rowsFor === "no-state"
        ? noStateTable()
        : <>
            <p className="m-0 text-sm text-[var(--body)]">{rowsFor.blurb}</p>
            {listTable(rowsFor.bucket, rowsFor.outcome)}
          </>}
    </DetailPanel>}
  </div>;
}

const CHECK_DOT: Record<ReviewBucket, string> = {
  ready: "bg-[var(--primary)]",
  duplicate_existing: "bg-[var(--warning)]",
  duplicate_in_file: "bg-[var(--warning)]",
  dnc_tenant: "bg-[var(--error)]",
  dnc_registry: "bg-[var(--error)]",
  dnc: "bg-[var(--error)]",
  litigator: "bg-[var(--error)]",
  invalid_phone: "bg-[var(--warning)]",
  unreadable: "bg-[var(--border-strong)]",
};

/** A one-line alert: something to act on now, never an explanation. */
function Alert({ tone, action, children }: { tone: "warning" | "error"; action?: ReactNode; children: ReactNode }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2 text-sm", tone === "error" ? "border-[var(--error)]/30 bg-[var(--error-surface)] text-[var(--error-ink)]" : "border-[var(--warning)]/30 bg-[var(--warning-surface)] text-[var(--warning-ink)]")}>
      <p className="m-0 min-w-0">{children}</p>
      {action}
    </div>
  );
}
