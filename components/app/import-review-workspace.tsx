"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Info } from "lucide-react";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { Callout, KeyValues, Pill, SettingsCard, SettingsTableCard, btn, st } from "@/components/app/settings/primitives";
import { ImportStepper } from "@/components/app/import-stepper";
import { sectionForPath } from "@/lib/menu/definition";
import { parseCsv } from "@/lib/agentTemplates/csv";
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

const LIST_PAGE = 50;

function ToneTile({ label, value, foot, tone }: { label: string; value: string; foot?: string; tone: "success" | "warning" | "info" | "error" }) {
  const ink = { success: "text-[var(--success-ink)]", warning: "text-[var(--warning-ink)]", info: "text-[var(--info-ink)]", error: "text-[var(--error-ink)]" }[tone];
  return (
    <div className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4">
      <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</div>
      <div className={cn("mt-1.5 text-[32px] leading-[1.13] font-semibold tracking-[-0.025em] tabular-nums", ink)}>{value}</div>
      {foot && <div className="mt-1.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{foot}</div>}
    </div>
  );
}

/** A definition on demand — click, focus or hover — for a figure whose name alone is not enough. */
function InfoTip({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle normal-case">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="ml-1 inline-flex size-4 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "absolute bottom-full left-1/2 z-10 mb-2 w-[260px] -translate-x-1/2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12px] leading-[1.5] font-normal tracking-[-0.01em] text-[var(--body)] shadow-[var(--shadow-overlay)]",
          open ? "block" : "hidden",
        )}
      >
        {children}
      </span>
    </span>
  );
}

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
  const [open, setOpen] = useState<ReviewBucket | null>(null);
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
      const state = (parsed[rowNumber - 1]?.[column] ?? "").trim().toUpperCase();
      if (state && !licensed.has(state)) byState.set(state, (byState.get(state) ?? 0) + 1);
    }
    const rows = [...byState.values()].reduce((sum, n) => sum + n, 0);
    const states = [...byState.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([state]) => state);
    return { rows, states };
  }, [territory, parsed, plan.stateHeader, plan.rows]);
  const offTerritoryCents = offTerritory && perDialable !== null ? perDialable * offTerritory.rows : null;

  function choiceFor(decision: Decision) {
    if (decision === "existing") return existingLeads === "attach" ? "Add the campaign" : "Skip them";
    if (decision === "infile") return duplicatesInFile === "first" ? "Keep the first" : "Skip every repeat";
    if (decision === "dnc") return dnc === "exclude" ? "Leave them out" : "Import and suppress";
    return null;
  }

  function viewList(bucket: ReviewBucket) {
    setOpen(bucket);
    setListing((current) => ({ ...current, [bucket]: current[bucket] ?? LIST_PAGE }));
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
            : "The campaign could not be marked as scrubbed, so the dialer will not serve these yet. Mark it on Vendors & campaigns, or re-run the import."}`,
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
      return <div className="min-w-0 overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <table className={st.table}>
          <thead><tr className={st.headRow}>{["Row", "Name", "Phone", "State", "Why"].map((head) => <th scope="col" key={head} className={st.th}>{head}</th>)}</tr></thead>
          <tbody>{samples.map((row) => <tr key={`${bucket}-${row.rowNumber}`}>
            <td className={cn(st.td, "tabular-nums")}>{row.rowNumber}</td><td className={st.td}>{row.name}</td>
            <td className={cn(st.td, "tabular-nums")}>{row.phone ?? "—"}</td><td className={st.td}>{row.state ?? "—"}</td>
            <td className={st.td}>{row.detail ?? "Ready"}</td>
          </tr>)}</tbody>
        </table>
        <p className="px-3 py-2 text-[12px] leading-[1.5] text-[var(--muted)]">Showing the first {samples.length} of {(counts[bucket] ?? 0).toLocaleString()}. Upload the file again to list every row.</p>
      </div>;
    }
    if (!parsed) return <p className="text-[14px] text-[var(--error-ink)]">The file in this tab could not be read to list these rows.</p>;
    const headers = parsed[0] ?? [];
    const shown = numbers.slice(0, listing[bucket] ?? LIST_PAGE);
    const withWhy = bucket === "unreadable" || bucket === "invalid_phone";
    return <div className="min-w-0 rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--muted)]">
        <span className="tabular-nums">Showing {shown.length.toLocaleString()} of {numbers.length.toLocaleString()} · read from the file in this tab</span>
        {shown.length < numbers.length && <button type="button" className={btn("row")} onClick={() => setListing((current) => ({ ...current, [bucket]: (current[bucket] ?? LIST_PAGE) + LIST_PAGE }))}>Show {Math.min(LIST_PAGE, numbers.length - shown.length)} more</button>}
      </div>
    </div>;
  }

  function decisionFieldset(decision: Decision, bucket: ReviewBucket) {
    const radio = "mt-1 size-4 shrink-0 accent-[var(--primary)]";
    const option = "flex cursor-pointer gap-2.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3";
    const title = "block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]";
    const help = "block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";
    const legend = "mb-2 text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
    if (decision === "dnc")
      return <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className={legend}>What should happen to do-not-call rows?</legend>
        <label className={option}><input type="radio" className={radio} name={`dnc-${bucket}`} checked={dnc === "exclude"} onChange={() => setDnc("exclude")} />
          <span><strong className={title}>Leave them out</strong><span className={help}>Do not import them at all. They stay on the vendor credit claim.</span></span></label>
        <label className={option}><input type="radio" className={radio} name={`dnc-${bucket}`} checked={dnc === "suppress"} onChange={() => setDnc("suppress")} />
          <span><strong className={title}>Import and suppress</strong><span className={help}>Keep the record and add the number to your do-not-call list permanently. It can never be dialed.</span></span></label>
        {/* Said plainly, because the missing option is the one people look for. */}
        <p className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--body)]">There is no option to dial these. A do-not-call number may only be called with a documented prior relationship or written consent, and an import screen cannot establish either. This choice applies to both do-not-call checks.</p>
      </fieldset>;
    if (decision === "existing")
      return <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className={legend}>What should happen to these?</legend>
        <label className={option}><input type="radio" className={radio} name="existing" checked={existingLeads === "attach"} onChange={() => setExistingLeads("attach")} />
          <span><strong className={title}>Add this campaign to the person you already have</strong><span className={help}>Keeps one lead and records that this vendor also sold them, so the cost is attributed correctly. No duplicate record, and nobody already worked goes back in the dialer.</span></span></label>
        <label className={option}><input type="radio" className={radio} name="existing" checked={existingLeads === "skip"} onChange={() => setExistingLeads("skip")} />
          <span><strong className={title}>Skip them</strong><span className={help}>Ignore these rows. The cost of the rows you paid for will not be attributed anywhere.</span></span></label>
      </fieldset>;
    if (decision === "infile")
      return <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className={legend}>What should happen to these?</legend>
        <label className={option}><input type="radio" className={radio} name="infile" checked={duplicatesInFile === "first"} onChange={() => setDuplicatesInFile("first")} />
          <span><strong className={title}>Keep the first one</strong><span className={help}>Import one lead per number and drop the repeats.</span></span></label>
        <label className={option}><input type="radio" className={radio} name="infile" checked={duplicatesInFile === "skip"} onChange={() => setDuplicatesInFile("skip")} />
          <span><strong className={title}>Skip every repeat</strong><span className={help}>Same result for the repeats; kept as an explicit choice.</span></span></label>
      </fieldset>;
    return null;
  }

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader
      eyebrow={sectionForPath("/app/import") ?? undefined}
      title="Review before committing"
      description="The last moment anyone can check what is about to enter the pipeline."
      actions={<button type="button" className={btn("secondary", "h-11")} onClick={() => router.push("/app/import")}>Start over</button>}
    />

    <ImportStepper current={committing ? 4 : 3} />

    <SettingsCard pad={20}>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "File", value: plan.fileName ?? "Not recorded" },
          { label: "Rows", value: plan.totalRows.toLocaleString() },
          { label: "Vendor", value: plan.vendorName ?? "—" },
          { label: "Campaign", value: plan.campaignName ?? "—" },
          { label: "Cost per accepted lead", value: plan.costCents === null ? "No cost entered" : money(perAccepted) },
        ].map((item) => <div key={item.label} className="min-w-0">
          <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{item.label}</dt>
          <dd className="m-0 mt-1 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums" title={item.value}>{item.value}</dd>
        </div>)}
      </dl>
    </SettingsCard>

    <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <ToneTile label="Accepted" value={accepted.toLocaleString()} foot={pct(accepted)} tone="success" />
      <ToneTile label="Duplicates" value={duplicates.toLocaleString()} foot={pct(duplicates)} tone="warning" />
      <ToneTile label="Suppressed" value={suppressed.toLocaleString()} foot={pct(suppressed)} tone="info" />
      <ToneTile label="Invalid" value={invalid.toLocaleString()} foot={pct(invalid)} tone="error" />
    </div>

    <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
      <SettingsTableCard
        className="min-w-0 flex-1"
        title="Validation & scrub"
        actions={accountedFor ? <Pill>every row accounted for</Pill> : <Pill tone="warning">rows do not add up</Pill>}
      >
        <table className={cn(st.table, "min-w-[520px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Check</th>
              <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Rows</th>
              <th scope="col" className={cn(st.th, "w-[120px] text-right")}><span className="sr-only">List</span></th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => {
              const count = counts[check.bucket] ?? 0;
              const expanded = open === check.bucket;
              const choice = count > 0 ? choiceFor(check.decision) : null;
              return <Fragment key={check.bucket}>
                <tr>
                  <td className={st.td}>
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`check-${check.bucket}`}
                        onClick={() => setOpen(expanded ? null : check.bucket)}
                        className="inline-flex min-w-0 items-center gap-1.5 text-left text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                      >
                        <ChevronRight className={cn("size-4 shrink-0 text-[var(--muted)] transition-transform", expanded && "rotate-90")} aria-hidden />
                        {check.label}
                      </button>
                      {choice && <Pill>{choice}</Pill>}
                    </span>
                  </td>
                  <td className={cn(st.td, "text-right tabular-nums")}>{count.toLocaleString()}</td>
                  <td className={cn(st.td, "text-right")}>
                    {count > 0
                      ? <button type="button" onClick={() => (listing[check.bucket] && expanded ? setListing((current) => { const next = { ...current }; delete next[check.bucket]; return next; }) : viewList(check.bucket))} className="inline-flex items-center gap-1.5 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] whitespace-nowrap text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                          {listing[check.bucket] && expanded ? "Hide list" : "View list"}<ArrowRight className="size-4" aria-hidden />
                        </button>
                      : <span className="text-[var(--muted)]">None</span>}
                  </td>
                </tr>
                {expanded && <tr id={`check-${check.bucket}`}>
                  <td colSpan={3} className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-4">
                    <div className="flex min-w-0 flex-col gap-3">
                      <p className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{check.blurb}</p>
                      {count > 0 && decisionFieldset(check.decision, check.bucket)}
                      {listing[check.bucket] && count > 0 && listTable(check.bucket, check.outcome)}
                    </div>
                  </td>
                </tr>}
              </Fragment>;
            })}
          </tbody>
          <tfoot>
            <tr className={st.headRow}>
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">
                {outcome.fresh.toLocaleString()} new · {outcome.added.toLocaleString()} added to existing · {outcome.leftOut.toLocaleString()} left out
              </td>
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5 text-right text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">{plan.totalRows.toLocaleString()}</td>
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </SettingsTableCard>

      <div className="flex min-w-0 flex-col gap-6 lg:w-[400px] lg:shrink-0">
        {/* LA-2.4-8: flagged before the commit, not discovered on the lead list afterwards. */}
        {noState.length > 0 && <Callout tone="warning" title={`${noState.length.toLocaleString()} new ${noState.length === 1 ? "lead has" : "leads have"} no state`}>
          <div className="flex flex-col gap-2">
            <p className="m-0">No state means no timezone, so the dialer will not call {noState.length === 1 ? "this lead" : "these leads"} until a state is added. {noState.length === 1 ? "It is" : "They are"} still imported, and the lead list shows {noState.length === 1 ? "it" : "them"} as missing a state.</p>
            <button type="button" className={btn("row", "self-start")} onClick={() => setNoStateShown((shown) => (shown ? 0 : LIST_PAGE))} aria-expanded={noStateShown !== 0}>
              {noStateShown ? "Hide rows" : "View rows"}
            </button>
            {noStateShown > 0 && (parsed
              ? <div className="min-w-0 overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
                  <table className={st.table}>
                    <thead><tr className={st.headRow}><th scope="col" className={st.th}>Row</th>{(parsed[0] ?? []).slice(0, 4).map((header, index) => <th scope="col" key={`${header}-${index}`} className={st.th}>{header}</th>)}</tr></thead>
                    <tbody>{noState.slice(0, noStateShown).map((rowNumber) => <tr key={rowNumber}>
                      <td className={cn(st.td, "tabular-nums")}>{rowNumber}</td>
                      {(parsed[0] ?? []).slice(0, 4).map((_, index) => <td key={index} className={cn(st.td, "whitespace-nowrap")}>{parsed[rowNumber - 1]?.[index] ?? ""}</td>)}
                    </tr>)}</tbody>
                  </table>
                  {noStateShown < noState.length && <button type="button" className={btn("row", "m-2")} onClick={() => setNoStateShown((shown) => shown + LIST_PAGE)}>Show {Math.min(LIST_PAGE, noState.length - noStateShown)} more</button>}
                </div>
              : <p className="m-0 text-[12px] text-[var(--error-ink)]">The file in this tab could not be read to list these rows.</p>)}
          </div>
        </Callout>}
        {fourSum === plan.totalRows
          ? <Callout tone="info" title="The four counts sum to the file’s row count">
              <span className="tabular-nums">{accepted.toLocaleString()} + {duplicates.toLocaleString()} + {suppressed.toLocaleString()} + {invalid.toLocaleString()} = {plan.totalRows.toLocaleString()}</span>
            </Callout>
          : <Callout tone="warning" title="The four counts do not sum to the file’s row count">
              <span className="tabular-nums">{accepted.toLocaleString()} + {duplicates.toLocaleString()} + {suppressed.toLocaleString()} + {invalid.toLocaleString()} = {fourSum.toLocaleString()}, not {plan.totalRows.toLocaleString()}</span>
            </Callout>}

        <SettingsCard pad={20} title="Cost allocation">
          <KeyValues items={[
            { label: "Batch cost", value: plan.costCents === null ? "Not entered" : formatCents(plan.costCents) },
            { label: "Accepted leads", value: accepted.toLocaleString() },
            { label: "Cost per accepted", value: money(perAccepted) },
            {
              label: <>Effective per dialable<InfoTip id="effective-per-dialable" label="What effective per dialable means">
                Batch cost ÷ rows that will be one of your leads and are not suppressed: new leads plus people you already have who get this campaign added. It moves with the choices in the table.
              </InfoTip></>,
              value: money(perDialable),
            },
            ...(offTerritory
              ? [{
                  label: <>Outside your licensed states<InfoTip id="off-territory" label="What outside your licensed states means">
                    New leads in this file whose state is not one your members are licensed in (Team &amp; access). They import, and nobody here can sell to them. Costed at the effective per dialable; a loss, not a vendor credit.
                  </InfoTip></>,
                  value: `${offTerritory.rows.toLocaleString()} ${offTerritory.rows === 1 ? "row" : "rows"}${offTerritoryCents !== null && offTerritory.rows > 0 ? ` · ${money(offTerritoryCents)}` : ""}`,
                }]
              : []),
          ]} />
          {offTerritory && offTerritory.rows > 0 && (
            <p className="mt-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">
              {offTerritoryCents !== null ? `${money(offTerritoryCents)} of this file` : `${offTerritory.rows.toLocaleString()} of these leads`} {offTerritoryCents !== null ? "is" : "are"} in {offTerritory.states.slice(0, 4).join(", ")}{offTerritory.states.length > 4 ? ` and ${offTerritory.states.length - 4} more` : ""}, outside your {plan.licensedStates?.length ?? 0} licensed states. It is not claimable — buy only the states you can sell next time.
            </p>
          )}
          <label htmlFor="add-spend" className={cn("mt-4 flex gap-2.5 border-t border-[var(--border)] pt-4", plan.costCents === null ? "cursor-not-allowed" : "cursor-pointer")}>
            <input id="add-spend" type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--primary)]" checked={addSpend && plan.costCents !== null} disabled={plan.costCents === null} onChange={(event) => setAddSpend(event.target.checked)} />
            <span className="min-w-0">
              <strong className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Add to {campaignLabel}’s spend</strong>
              <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                {plan.costCents === null
                  ? "No batch cost was entered on the upload step, so there is nothing to add."
                  : `Adds ${formatCents(plan.costCents)} and ${(plan.recordsPurchased ?? plan.totalRows).toLocaleString()} rows purchased to the campaign’s totals, in the same transaction as the leads. Untick it if the campaign already includes this file’s cost.`}
              </span>
            </span>
          </label>
        </SettingsCard>

        <div className="flex flex-col gap-2">
          <p className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            {willImport === 0
              ? "Nothing in this file will be imported with these choices."
              : "Committed as one transaction — all of it or none of it. Nothing has been written until you press this."}
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" className={btn("secondary", "h-11")} onClick={() => router.push("/app/import")}>Back</button>
            <button type="button" className={btn("primary", "h-11")} disabled={committing || willImport === 0} onClick={() => void commit()}>
              {committing ? "Importing…" : `Import ${willImport.toLocaleString()} lead${willImport === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
