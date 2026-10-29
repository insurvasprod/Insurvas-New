"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Ban, Check, CopyCheck, CopyX, FileText, MapPinOff, Minus, ShieldBan, SkipForward, Trash2, UserCheck, UserPlus, type LucideIcon } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Card, cardInset } from "@/components/ui/card";
import { DetailPanel } from "@/components/ui/detail-panel";
import { ToggleRow } from "@/components/ui/field";
import { InfoTip } from "@/components/ui/info-tip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TableCard } from "@/components/ui/table-card";
import { st } from "@/components/app/settings/primitives";
import { LeadsInSlot } from "@/components/app/lead-sources/leads-in-slot";
import { discardStagedFile } from "@/components/app/import-discard";
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
  /** The campaign the file was staged for, so "upload it again" can open Import on it. */
  campaignId?: string | null;
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
 * Every check is one bucket of the file. The order is deliberate: what will land first, then who you
 * already have, then what cannot legally be dialled, then what was never a usable row. A bucket that
 * carries a choice is asked as one question (step 3 · Review, owner 2026-10-28: "it's not helping them
 * decide what is the next step"); the rest are what was taken out, or passed.
 */
const CHECKS: Array<{ bucket: ReviewBucket; outcome: Outcome; label: string; note: string; blurb: string; decision: Decision }> = [
  { bucket: "ready", outcome: "ready", label: "Clean and new", note: "imported as new leads", decision: null, blurb: "Clean, scrubbed, and not already in your leads. These are imported." },
  // "Already in your leads": whether two contacts are one person is step 4 · Clean's question, not this one.
  { bucket: "duplicate_existing", outcome: "duplicate_existing", label: "Already in your leads", note: "same phone · second source", decision: "existing", blurb: "The number matches a lead you already have. Adding the campaign keeps one lead; anyone already worked is not put back in the dialer." },
  { bucket: "duplicate_in_file", outcome: "duplicate_in_file", label: "Twice in this file", note: "first kept · repeats to vendor credit", decision: "infile", blurb: "The same number appears more than once. The first is imported; every repeat is left out and recorded against the campaign for a vendor credit — the vendor billed the same person twice." },
  { bucket: "dnc_tenant", outcome: "dnc", label: "Your own Do Not Call", note: "never dialled", decision: "dnc", blurb: "The number is on your own do-not-call list." },
  { bucket: "dnc_registry", outcome: "dnc", label: "Do Not Call registry", note: "federal or state list", decision: "dnc", blurb: "The number matched the do-not-call registry your scrub vendor checks." },
  { bucket: "dnc", outcome: "dnc", label: "On a do-not-call list", note: "source not recorded", decision: "dnc", blurb: "Checked before the source of a do-not-call match was recorded: your own list or the registry." },
  { bucket: "litigator", outcome: "litigator", label: "TCPA litigator", note: "never imported · vendor credit", decision: null, blurb: "Never importable and never dialable, under any setting. Recorded as evidence so you can claim the money back from the vendor." },
  { bucket: "invalid_phone", outcome: "invalid_phone", label: "Bad phone", note: "nothing to dial", decision: null, blurb: "Nothing to dial, so these are left out. A number the scrub vendor reports as not real is recorded against the campaign for a vendor credit." },
  { bucket: "unreadable", outcome: "unreadable", label: "Unreadable", note: "fix it in the file", decision: null, blurb: "These could not be read, so they cannot be imported. Fix them in the file and upload it again." },
];

/**
 * The questions, one per decision the import API takes (`decisions` on PUT …/preflight): a short title
 * and its two answers, each a label, one short line and an icon; the first answer is the default and is
 * marked Recommended. Nothing here the API lacks.
 */
type Answer = { value: string; label: string; help: string; icon: LucideIcon };
const QUESTIONS: Record<Exclude<Decision, null>, { title: string; note?: string; options: [Answer, Answer] }> = {
  existing: {
    title: "Already in your leads",
    options: [
      { value: "attach", icon: UserPlus, label: "Add the campaign to them", help: "History kept · nobody re-dialled" },
      { value: "skip", icon: SkipForward, label: "Skip them", help: "Not imported · cost not attributed" },
    ],
  },
  infile: {
    title: "Twice in this file",
    options: [
      { value: "first", icon: CopyCheck, label: "Keep the first", help: "Repeats left out · vendor credit" },
      { value: "skip", icon: CopyX, label: "Skip every repeat", help: "Same result, as an explicit choice" },
    ],
  },
  // Said plainly, because the missing option is the one people look for.
  dnc: {
    title: "On a do-not-call list",
    note: "There is no option to dial these.",
    options: [
      { value: "exclude", icon: Ban, label: "Leave them out", help: "Not imported · kept on the vendor credit" },
      { value: "suppress", icon: ShieldBan, label: "Import and suppress", help: "Kept · on your do-not-call list for good" },
    ],
  },
};
const DECISION_ORDER = ["existing", "infile", "dnc"] as const;

const LIST_PAGE = 10;

/** Settings › Team & access, where the owner records each member's licensed states. */
const LICENCES_HREF = "/app/settings#team-access";

type ImportSummary = { imported: number; attachedToExisting: number; suppressed: number; rejectionsRecorded: number; servable: boolean; campaignStatus: string | null; spendAddedCents: number; certificatesFiled?: number; noState?: number; warning?: string | null };

/** The server refused the commit (4xx/5xx with a reason), as opposed to the request never landing. */
class ImportRefused extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) { super(message); }
}

const money = (cents: number | null) => (cents === null ? "—" : formatCents(Math.round(cents)));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The parser's header normalization (lib/agentTemplates/csv.ts), so a mapped header is found again. */
const normalizedHeader = (value: string) => value.replace(/^﻿/, "").trim().toLocaleLowerCase();

export function ImportReviewWorkspace({ plan, csv }: { plan: ReviewPlan; csv: string }) {
  const router = useRouter();
  const [duplicatesInFile, setDuplicatesInFile] = useState<"first" | "skip">("first");
  const [existingLeads, setExistingLeads] = useState<"attach" | "skip">("attach");
  const [dnc, setDnc] = useState<"exclude" | "suppress">("exclude");
  const [addSpend, setAddSpend] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
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
   * left out from the buckets themselves, so "every row accounted for" is a real check.
   */
  const outcome = useMemo(
    () => reviewOutcome(counts, plan.dncBreakdown, { duplicatesInFile, existingLeads, dnc }),
    [counts, plan.dncBreakdown, duplicatesInFile, existingLeads, dnc],
  );
  const willImport = outcome.willImport;
  const accountedFor = outcome.fresh + outcome.added + outcome.leftOut === plan.totalRows;

  // The funnel's boxes, each one a card below: people you already have (with the do-not-call ones
  // among them once those are imported), then everything else the checks took out.
  const attach = existingLeads === "attach";
  const alreadyYours = counts.duplicate_existing + (dnc === "suppress" ? plan.dncBreakdown.existing : 0);
  const alreadySkipped = attach ? 0 : alreadyYours;
  const removedByChecks = outcome.leftOut - alreadySkipped;

  // The four kinds of bucket, folded from the checks below, so the summary and the cards can never
  // disagree.
  const accepted = counts.ready;
  const duplicates = counts.duplicate_existing + counts.duplicate_in_file;
  const suppressed = counts.dnc_tenant + counts.dnc_registry + counts.dnc + counts.litigator;
  const invalid = counts.invalid_phone + counts.unreadable;
  const fourSum = accepted + duplicates + suppressed + invalid;

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
  const outside = offTerritory && offTerritory.rows > 0 ? offTerritory : null;

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

  async function send(): Promise<{ summary: ImportSummary; redirect: unknown }> {
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
    if (!response.ok) throw new ImportRefused(body?.error ?? "Could not import these leads", response.status, typeof body?.code === "string" ? body.code : null);
    return { summary: body.summary as ImportSummary, redirect: body.redirect };
  }

  // What the toast says once the import is in: the counts, then anything that stops these leads
  // being dialled yet.
  function outcomeOf(summary: ImportSummary) {
    const counted =
      `${summary.imported.toLocaleString()} imported`
      + (summary.attachedToExisting ? ` · ${summary.attachedToExisting.toLocaleString()} added to people you already had` : "")
      + (summary.suppressed ? ` · ${summary.suppressed.toLocaleString()} imported and suppressed` : "")
      + (summary.rejectionsRecorded ? ` · ${summary.rejectionsRecorded.toLocaleString()} recorded for a vendor credit` : "")
      + (summary.certificatesFiled ? ` · ${summary.certificatesFiled.toLocaleString()} consent certificate${summary.certificatesFiled === 1 ? "" : "s"} filed` : "");
    // Said after the commit as well as before it: these leads are in, and will not be called yet.
    const followUps = [summary.noState ? `${summary.noState.toLocaleString()} new lead${summary.noState === 1 ? " has" : "s have"} no state and will not be dialled until one is added.` : null, summary.warning ?? null].filter(Boolean).join(" ");
    const spend = [summary.spendAddedCents > 0 ? `${formatCents(summary.spendAddedCents)} added to ${campaignLabel}'s spend.` : null, followUps || null].filter(Boolean).join(" ") || undefined;
    if (summary.servable || summary.imported + summary.attachedToExisting === 0) return { title: counted, detail: spend };
    return {
      title: counted,
      treatment: "warn" as const,
      detail: `${spend ? `${spend} ` : ""}${summary.campaignStatus && summary.campaignStatus !== "active"
        ? `${campaignLabel} is ${summary.campaignStatus}, so the dialer will not serve these leads until it is active.`
        : summary.warning ? "" : "The campaign could not be marked as scrubbed, so the dialer will not serve these yet. Mark it on Vendors & campaigns, or re-run the import."}`.trim(),
    };
  }

  async function commit() {
    setCommitting(true);
    try {
      // One toast for the whole commit (2026-10-28): a spinner while the rows are written, then the
      // counts or the refusal in the same place.
      await notify.promise(send(), {
        loading: `Importing ${willImport.toLocaleString()} lead${willImport === 1 ? "" : "s"}…`,
        done: ({ summary }) => outcomeOf(summary),
        // A plan limit names its way out: Plan & billing.
        fail: (error) => error instanceof ImportRefused && error.code === "limit_reached"
          ? { title: error.message, treatment: "block", action: { label: "See plans", onClick: () => router.push("/app/settings#billing") } }
          : error instanceof ImportRefused
          ? { title: error.message, treatment: "block" }
          : { title: "The import could not be confirmed. You can retry safely.", treatment: "fail" },
      });
      try { sessionStorage.removeItem(`${IMPORT_CSV_KEY}:${plan.batchId}`); } catch { /* the tab keeps it until it closes */ }
      // On to step 4 · Clean (owner 2026-10-28: continue in order), not the lead list the API names;
      // Clean's empty state continues to Lists, where these leads are.
      router.push("/app/duplicates");
    } catch (error) {
      // Already imported — elsewhere, or by a second press. The page shows that state.
      if (error instanceof ImportRefused && error.status === 409) router.refresh();
    } finally {
      setCommitting(false);
    }
  }

  /** Clean-up (2026-10-29): drop the staged file without importing it, then back to Import. */
  async function discard() {
    setDiscarding(true);
    try {
      const result = await discardStagedFile(plan.batchId, plan.fileName);
      if (result === "done") router.push("/app/import");
      else if (result === "imported") router.refresh();
    } finally {
      setDiscarding(false);
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
   * A question's two answers, as radio cards: an icon, a short label and one short line. The default is
   * drawn chosen from the start and marked Recommended, so nobody has to wonder what happens if they
   * press Import untouched. Real radio inputs, so it reads and keys like a fieldset.
   */
  function choiceSwitch(decision: Exclude<Decision, null>) {
    const { options } = QUESTIONS[decision];
    const value = decision === "existing" ? existingLeads : decision === "infile" ? duplicatesInFile : dnc;
    const pick = (next: string) => {
      if (decision === "existing") setExistingLeads(next as typeof existingLeads);
      else if (decision === "infile") setDuplicatesInFile(next as typeof duplicatesInFile);
      else setDnc(next as typeof dnc);
    };
    return <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0 sm:grid-cols-2">
      <legend className="sr-only">What to do with these rows</legend>
      {options.map((option, index) => {
        const chosen = value === option.value;
        const Icon = option.icon;
        return <label key={option.value} className={cn(
          "flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring-color)]",
          chosen ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] hover:border-[var(--border-strong)]",
        )}>
          <input type="radio" className="sr-only" name={`choice-${decision}`} value={option.value} checked={chosen} onChange={() => pick(option.value)} />
          <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", chosen ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">{option.label}</span>
              {index === 0 && <StatusChip tone="action" dot={false}>Recommended</StatusChip>}
            </span>
            <span className="block text-xs leading-[1.5] text-[var(--body)]">{option.help}</span>
          </span>
          <span aria-hidden className={cn("size-3.5 shrink-0 rounded-full", chosen ? "border-[4px] border-[var(--primary)]" : "border-[1.5px] border-[var(--border-strong)]")} />
        </label>;
      })}
    </fieldset>;
  }

  // Step 3 · Review of the Lead sources page (owner 2026-10-28, "it's not helping them decide what is
  // the next step"; /ui-taste pass 2026-10-29): two columns. On the left the funnel, then one question
  // card per decision the API takes, then the warnings, then what the checks took out; the summary
  // and the money on the right, sticky. Back and Import in the frame's corner.
  const found = checks.filter((check) => (counts[check.bucket] ?? 0) > 0);
  const none = checks.filter((check) => (counts[check.bucket] ?? 0) === 0 && check.bucket !== "ready");
  const readyCheck = CHECKS[0];
  // One card per decision: the do-not-call buckets share one, on the first of them found.
  const questions = DECISION_ORDER
    .map((decision) => ({ decision, checks: found.filter((check) => check.decision === decision) }))
    .filter((question) => question.checks.length > 0);
  const takenOut = found.filter((check) => check.bucket !== "ready" && check.decision === null);

  /** One question: its title and count, the rows on demand, and its two answers. */
  function questionCard({ decision, checks: asked }: (typeof questions)[number]) {
    const total = asked.reduce((sum, check) => sum + (counts[check.bucket] ?? 0), 0);
    const only = asked.length === 1 ? asked[0] : null;
    const { title, note } = QUESTIONS[decision];
    return <Card key={decision} aria-labelledby={`question-${decision}`} className="min-w-0 gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id={`question-${decision}`} className="m-0 text-card-title text-[var(--ink)]">{title}</h2>
        <StatusChip tone="neutral" className="tabular-nums">{total.toLocaleString()}</StatusChip>
        <span className="flex-1" />
        {only && <Button type="button" size="sm" variant="ghost" onClick={() => openRows(only)}>View {plural(total, "row")}</Button>}
      </div>
      {/* Several buckets behind one question (your own list, the registry): each keeps its own rows. */}
      {!only && <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{asked.map((check) => {
        const count = counts[check.bucket] ?? 0;
        return <li key={check.bucket} className={cn(cardInset, "flex items-center gap-2 py-0.5 pr-0.5 pl-3")}>
          <span className="text-xs leading-[1.5] text-[var(--body)]">{check.label}</span>
          <strong className="text-sm font-semibold tabular-nums text-[var(--ink)]">{count.toLocaleString()}</strong>
          <Button type="button" size="sm" variant="ghost" aria-label={`View ${plural(count, "row")}: ${check.label}`} onClick={() => openRows(check)}>View {plural(count, "row")}</Button>
        </li>;
      })}</ul>}
      {choiceSwitch(decision)}
      {note && <span className="flex items-center gap-1.5 text-xs leading-[1.5] text-[var(--body)]"><Ban aria-hidden className="size-3.5 shrink-0" />{note}</span>}
    </Card>;
  }

  /** A check with no choice: its dot, name, short consequence and count; its rows on demand. */
  function checkRow(check: (typeof CHECKS)[number]) {
    const count = counts[check.bucket] ?? 0;
    return <li key={check.bucket} className={cn(cardInset, "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5")}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", CHECK_DOT[check.bucket])} />
      <strong className="min-w-0 flex-1 text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">{check.label}</strong>
      <span className="text-xs leading-[1.5] text-[var(--body)]">{check.note}</span>
      <strong className="w-12 text-right text-sm font-semibold tabular-nums text-[var(--ink)]">{count.toLocaleString()}</strong>
      <Button type="button" size="sm" variant="ghost" aria-label={`View ${plural(count, "row")}: ${check.label}`} onClick={() => openRows(check)}>View {plural(count, "row")}</Button>
    </li>;
  }

  /** One box of the funnel: an icon, a label, the number, and anything said under it. */
  function flowBox({ icon: Icon, label, value, op, opLabel, children, strong = false }: { icon: LucideIcon; label: string; value: number; op?: LucideIcon; opLabel?: string; children?: ReactNode; strong?: boolean }) {
    const Op = op;
    return <div key={label} className="flex min-w-0 items-center gap-2">
      {Op && <><Op aria-hidden className="size-4 shrink-0 text-[var(--muted)]" /><span className="sr-only">{opLabel}</span></>}
      <span className={cn("flex min-w-[132px] items-center gap-2.5 px-3 py-2", strong ? "rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)]" : cardInset)}>
        <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", strong ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}><Icon className="size-4" /></span>
        <span className="flex min-w-0 flex-col">
          <span className="text-xs leading-[1.5] text-[var(--body)]">{label}</span>
          <strong className="text-xl leading-tight font-semibold tabular-nums text-[var(--ink)]">{value.toLocaleString()}</strong>
          {children}
        </span>
      </span>
    </div>;
  }

  const willImportTitle = willImport === 0
    ? "Nothing in this file will be imported with these choices."
    : `Imports ${plural(willImport, "lead")}, then you check duplicates. Nothing has been written until you press this: all of it or none of it.`;

  const line = "flex items-baseline justify-between gap-3 text-sm";
  const lineLabel = "shrink-0 text-[var(--body)]";
  const lineValue = "m-0 min-w-0 truncate text-right font-semibold tabular-nums text-[var(--ink)]";

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
    {/* The one way on, in the frame's corner where every other step has "Continue to …". Back, beside
        it, returns to Import: the same place "Start over" went, so there is one button for it. */}
    <LeadsInSlot slot="continue">
      <Button type="button" title={willImportTitle} disabled={committing || discarding || willImport === 0} onClick={() => void commit()}>
        {committing ? "Importing…" : `Import ${willImport.toLocaleString()} lead${willImport === 1 ? "" : "s"}`}
      </Button>
    </LeadsInSlot>

    {fourSum !== plan.totalRows && <Alert tone="warning">
      The four counts add up to <span className="tabular-nums">{fourSum.toLocaleString()}</span>, not the file&rsquo;s <span className="tabular-nums">{plan.totalRows.toLocaleString()}</span> rows.
    </Alert>}
    {/* Nothing to import with these answers: said where it is seen, with the way out beside it. */}
    {willImport === 0 && <Alert tone="warning" action={<Button type="button" variant="outline" size="sm" disabled={committing || discarding} onClick={() => void discard()}><Trash2 aria-hidden="true" />{discarding ? "Discarding…" : "Discard this file"}</Button>}>
      Nothing in this file will be imported{questions.length > 0 ? " with these answers" : ""}.
    </Alert>}
    {!accountedFor && <Alert tone="warning">
      These choices account for <span className="tabular-nums">{(outcome.fresh + outcome.added + outcome.leftOut).toLocaleString()}</span> of the file&rsquo;s <span className="tabular-nums">{plan.totalRows.toLocaleString()}</span> rows.
    </Alert>}

    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        {/* The funnel, left to right, each box one of the cards below: in the file − already yours −
            removed by the checks → will be imported. It moves with the answers. */}
        <Card aria-label="What will be imported" className="min-w-0 flex-row flex-wrap items-center gap-2 p-3">
          {flowBox({ icon: FileText, label: "In the file", value: plan.totalRows })}
          {alreadyYours > 0 && flowBox({
            icon: UserCheck,
            label: "Already yours",
            value: alreadyYours,
            op: attach ? ArrowRight : Minus,
            opLabel: attach ? "then" : "minus",
            children: <span className="text-xs leading-[1.5] text-[var(--body)]">{attach ? "added" : "skipped"}</span>,
          })}
          {removedByChecks > 0 && flowBox({ icon: Ban, label: "Removed by checks", value: removedByChecks, op: Minus, opLabel: "minus" })}
          {flowBox({
            icon: Check,
            label: "Will be imported",
            value: willImport,
            op: ArrowRight,
            opLabel: "equals",
            strong: true,
            children: <>
              {attach && alreadyYours > 0 && <span className="text-xs leading-[1.5] text-[var(--body)]">incl. {alreadyYours.toLocaleString()} already yours</span>}
              {outside && <span className="flex items-center gap-1 text-xs leading-[1.5] text-[var(--warning-ink)]"><MapPinOff aria-hidden className="size-3.5 shrink-0" />{outside.rows.toLocaleString()} outside your states</span>}
            </>,
          })}
          {accepted > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => openRows(readyCheck)}>
            {accepted === willImport ? `View ${plural(accepted, "row")} to import` : `View ${plural(accepted, "new row")}`}
          </Button>}
          {/* What the checks looked for and did not find, folded into one chip; and the sum, checked. */}
          {none.length > 0 && <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ml-auto inline-flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatusChip tone="good" dot={false}><Check aria-hidden className="size-3.5" />{plural(none.length, "check")} passed</StatusChip>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Checked, none found">
                {none.map((check) => <li key={check.bucket} className="flex items-center gap-2 text-sm text-[var(--ink)]"><Check aria-hidden className="size-3.5 shrink-0 text-[var(--success-ink)]" />{check.label}</li>)}
              </ul>
              {accountedFor && <p className="m-0 mt-2.5 border-t border-[var(--border)] pt-2 text-xs leading-[1.5] text-[var(--body)] tabular-nums">
                Every row accounted for: {plan.totalRows.toLocaleString()} = {willImport.toLocaleString()} imported + {outcome.leftOut.toLocaleString()} left out
              </p>}
            </PopoverContent>
          </Popover>}
        </Card>

        {/* Needs you: one card per decision. */}
        {questions.map(questionCard)}

        {/* Warnings: imported, and not dialled or not sellable. */}
        {/* New leads in states nobody here may sell in. They import (the API has no choice to leave them
            out), so the row counts them and their cost and points at where licences are recorded. */}
        {outside && <WarningRow
          icon={MapPinOff}
          action={<Button asChild type="button" variant="ghost" size="sm"><Link href={LICENCES_HREF}>Add a licence<ArrowRight aria-hidden /></Link></Button>}
        >
          <strong className="font-semibold">{plural(outside.rows, "new lead")} outside your licensed states</strong>
          <span> · {outside.states.slice(0, 4).join(", ")}{outside.states.length > 4 ? ` and ${outside.states.length - 4} more` : ""}{offTerritoryCents !== null ? ` · ${money(offTerritoryCents)}` : ""} · imported anyway</span>
        </WarningRow>}

        {/* LA-2.4-8: flagged before the commit, not discovered on the lead list afterwards. */}
        {noState.length > 0 && <WarningRow icon={MapPinOff} action={<Button type="button" variant="ghost" size="sm" onClick={() => openNoState()}>View {plural(noState.length, "row")}</Button>}>
          {noState.length.toLocaleString()} new {noState.length === 1 ? "lead has" : "leads have"} no state, so the dialer will not call {noState.length === 1 ? "it" : "them"} until one is added.
        </WarningRow>}

        {/* What the checks took out with no choice to make. What they found nothing for is the chip above. */}
        {takenOut.length > 0 && <Card aria-labelledby="taken-out" className="min-w-0 gap-2.5 p-4">
          <h2 id="taken-out" className="m-0 text-card-title text-[var(--ink)]">Taken out before anyone dials</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{takenOut.map(checkRow)}</ul>
        </Card>}
      </div>

      {/* The summary: where it goes, what it cost, and what it costs per lead with these answers. */}
      <Card aria-label="Summary" className="min-w-0 gap-3 p-4 lg:sticky lg:top-0">
        <dl className="m-0 flex flex-col gap-1.5">
          <div className={line}><dt className={lineLabel}>Campaign</dt><dd className={lineValue} title={campaignLabel}>{campaignLabel}</dd></div>
          {plan.vendorName && <div className={line}><dt className={lineLabel}>Vendor</dt><dd className={lineValue} title={plan.vendorName}>{plan.vendorName}</dd></div>}
          <div className={line}><dt className={lineLabel}>File</dt><dd className={lineValue} title={plan.fileName ?? undefined}>{plan.fileName ?? "Not recorded"}</dd></div>
        </dl>
        <div className="border-t border-[var(--border)]" />
        {plan.costCents === null
          ? <div className={line}>
              <span className={lineLabel}>Paid</span>
              {/* The commit takes no cost; it is entered with the file on Import. */}
              <Button asChild type="button" variant="ghost" size="sm"><Link href="/app/import">Enter what you paid<ArrowRight aria-hidden /></Link></Button>
            </div>
          : <>
              <dl className="m-0 flex flex-col gap-1.5">
                <div className={line}><dt className={lineLabel}>Paid</dt><dd className={lineValue}>{formatCents(plan.costCents)}</dd></div>
                {perAccepted !== null && <div className={line}><dt className={lineLabel}>Per accepted lead</dt><dd className={lineValue}>{money(perAccepted)}</dd></div>}
                {perDialable !== null && <div className={line}>
                  <dt className={lineLabel}>Per usable lead<InfoTip className="ml-1" label="What effective per dialable means">
                    Batch cost ÷ rows that will be one of your leads and are not suppressed: new leads plus people you already have who get this campaign added. It moves with your choices.
                  </InfoTip></dt>
                  <dd className="m-0 font-semibold tabular-nums text-[var(--accent-ink)]">{money(perDialable)}</dd>
                </div>}
              </dl>
              <ToggleRow
                id="add-spend"
                title={`Add to ${campaignLabel}’s spend`}
                help={`${formatCents(plan.costCents)} · ${(plan.recordsPurchased ?? plan.totalRows).toLocaleString()} rows purchased`}
                checked={addSpend}
                onChange={setAddSpend}
                disabled={committing}
              />
            </>}
        <div className="border-t border-[var(--border)]" />
        <Button type="button" variant="outline" className="text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" disabled={committing || discarding} onClick={() => void discard()}>
          <Trash2 aria-hidden="true" />{discarding ? "Discarding…" : "Discard this file"}
        </Button>
      </Card>
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

/** A compact amber row: a fact about rows that import anyway, and the one thing to do about it. */
function WarningRow({ icon: Icon, action, children }: { icon: LucideIcon; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] py-1.5 pr-1.5 pl-3 text-sm text-[var(--warning-ink)]">
      <Icon aria-hidden className="size-4 shrink-0" />
      <p className="m-0 min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}
