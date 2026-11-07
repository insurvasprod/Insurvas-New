import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { fileDay } from "@/lib/ingestion/constants";
import { loadFileHead, loadRowStory } from "@/lib/ingestion/fileOutcomeStore";
import { CHANGE_FIELD_LABELS, ROW_OUTCOME_LABELS, ROW_OUTCOME_TONES, changeValue, policyHref } from "@/lib/ingestion/fileStages";
import { TARGET_FIELDS, unwrapExcelText } from "@/lib/ingestion/layout";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileHref, rowHref, type ColumnTrace } from "@/lib/ingestion/trace";
import { loadRowTrace } from "@/lib/ingestion/traceStore";
import type { NeedsYouKind } from "@/lib/needsYou/kinds";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { RowAsSent, type AsSentEntry } from "@/components/app/book/row/row-as-sent";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { cn } from "@/lib/utils";

/**
 * Book of business › Files › a file › a row (LA-4.20, Notion sprint; round 2, owner 2026-11-02 — was a
 * side panel in round 1): one row of a carrier file as a detail page. What happened: each stage for this
 * one row in words, with the way to change its client, its policy's history and the card it moved. As
 * sent: every original column, the field each became and the value as a person reads it — the screen
 * that answers "did we read this right?" without a database client. Owner and bookkeeper. Opening it
 * writes nothing.
 *
 * Round 5 (board 5, docs/la4/mockups-r5/book-commissions-r5.html): the policy number and the client are the
 * title; ‹ Row and Row › step through the file; one primary, "Open the policy"; no More menu. One page, no
 * tabs: "What happened" as a stepper beside "The row as sent" (two columns from 1100px). The old ?tab=sent
 * address still opens: both halves are on the page.
 */
const cents = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A stage's action read as a link in the folded "Nothing to do" line (in a stage row it is a row button). */
const linkWrap = "[&>a]:font-semibold [&>a]:text-[var(--accent-ink)] [&>a:hover]:underline";
const words = (value: string | null) => (value ? value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "");

/** A field's full name, from the layout's own list ("Paid-to date"). */
const FIELD_NAMES = new Map(Object.values(TARGET_FIELDS).flat().map((field) => [field.key, field.label]));

/** What a column became, in a word or two ("→ policy number"): the name the change list uses, else the layout's. */
function becameWord(field: string): string {
  if (field.startsWith("insured_")) return "to match the client";
  if (field === "carrier_status_raw") return "status";
  const name = CHANGE_FIELD_LABELS[field] ?? FIELD_NAMES.get(field)?.replace(/\s*\(.*\)$/, "") ?? field.replace(/_cents$/, "").replaceAll("_", " ");
  return name.toLowerCase();
}

/** A date someone reads: an ISO day or a US m/d/yyyy one. A bare five-digit number is never taken for a date here (a ZIP). */
function readableDay(value: string): string | null {
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  if (match) return fileDay(`${match[1]}-${match[2]}-${match[3]}`);
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (match) return fileDay(`${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`);
  return null;
}

/** One column as a person reads it, what it became, and the cell as sent behind it. */
function asSent(c: ColumnTrace, index: number): AsSentEntry {
  const plain = unwrapExcelText(c.value);
  let shown = plain;
  if (c.becameField) {
    if (c.dataType === "int_cents" && c.stored !== null && /^-?\d+$/.test(c.stored)) shown = cents(Number(c.stored));
    else if (c.dataType === "date" && c.stored) shown = readableDay(c.stored) ?? readableDay(plain) ?? plain;
    else if (c.dataType === "date") shown = readableDay(plain) ?? plain;
  } else {
    shown = readableDay(plain) ?? plain;
  }
  const kept = c.becameField
    ? c.stored ?? (c.becameField.startsWith("insured_") ? "used to match the client, not kept on the policy" : null)
    : null;
  const becameTitle = c.becameField
    ? [
        FIELD_NAMES.get(c.becameField) ?? c.becameField,
        c.dataType ? `${c.dataType}${c.transform && c.transform !== "none" ? ` · ${c.transform}` : ""}${c.required ? " · required" : ""}` : null,
        kept !== null ? `kept as ${kept}` : null,
      ].filter(Boolean).join(" · ")
    : null;
  return {
    key: `${index}:${c.column}:${c.header}`,
    column: c.column,
    header: c.header,
    shown: shown.trim() === "" ? "" : shown,
    raw: shown !== c.value && c.value !== "" ? c.value : null,
    became: c.becameField ? becameWord(c.becameField) : null,
    becameTitle,
    mono: c.becameField === "policy_number" || c.becameField === "agent_identifier",
  };
}

/** The Needs you Review page, opened at one "Pick the client" item (the file page's Review links use the same page). */
const pickClientHref = (reviewId: string, from: string) => `/app/needs-you/review?${new URLSearchParams({ kind: "pick-client" satisfies NeedsYouKind, id: reviewId, from })}`;

type StepState = "done" | "needs" | "none";
const DOT_SAID: Record<StepState, string> = { done: "Done", needs: "Waits for you", none: "Nothing to do" };

export default async function RawRowPage({ params }: { params: Promise<{ fileId: string; rowNumber: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files, and the rows in them, are opened by the account owner or a bookkeeper." />;
  const { fileId, rowNumber } = await params;
  const n = Number(rowNumber);
  if (!isRecordUuid(fileId) || !Number.isInteger(n) || n < 1) notFound();
  const tenantId = guard.context.tenantId;
  const [row, head] = await Promise.all([loadRowTrace(tenantId, fileId, n), loadFileHead(tenantId, fileId)]);
  if (!row || !head) notFound();
  const story = await loadRowStory(tenantId, fileId, n);
  const outcome = story?.row ?? null;
  const policy = row.snapshot?.policyNumber ?? outcome?.policyNumber ?? row.lines[0]?.policyNumber ?? null;
  const carrierId = row.snapshot?.carrierId ?? row.lines[0]?.carrierId ?? head.carrierId;
  const policyLink = (tabName?: "client" | "history" | "pipeline" | "commissions") => (policy && carrierId ? policyHref(carrierId, policy, tabName) : null);
  const prev = row.prevRow !== null ? rowHref(row.file.id, row.prevRow) : null;
  const next = row.nextRow !== null ? rowHref(row.file.id, row.nextRow) : null;
  const read = row.columns.filter((c) => c.becameField);
  const unread = row.columns.filter((c) => !c.becameField);
  const title = [policy, outcome?.clientName].filter(Boolean).join(" · ") || `Row ${row.rowNumber}`;

  // ─── What happened: one line per stage, in words, with its one link ──────────────────────────
  const commissionFile = head.fileType === "commissions";
  const snap = story?.snapshot ?? null;
  const readFacts = row.snapshot
    ? [`Policy ${row.snapshot.policyNumber}`, snap?.premiumCents !== null && snap?.premiumCents !== undefined ? `${cents(snap.premiumCents)}${snap.premiumMode ? ` ${snap.premiumMode}` : ""}` : null, snap?.paidTo ? `paid to ${fileDay(snap.paidTo)}` : null].filter(Boolean).join(" · ")
    : row.lines.length ? `${row.lines.length} commission ${row.lines.length === 1 ? "line" : "lines"} on ${row.lines[0].policyNumber}` : "Nothing read from this row";
  const changed = !commissionFile && Boolean(outcome?.changes.length);
  const steps: Array<{ stage: string; state: StepState; text: ReactNode; action?: ReactNode }> = [
    { stage: "Uploaded", state: "done", text: `${row.file.name} · file of ${fileDay(row.file.fileDate)}`, action: <Link href={fileHref(row.file.id)}>The file</Link> },
    {
      stage: "Read",
      state: row.snapshot || row.lines.length ? "done" : "none",
      text: row.map
        ? `With ${row.map.name} v${row.map.version} · ${read.length} of ${row.columns.length} columns used${unread.length ? `, ${unread.length} kept unread` : ""} · ${readFacts}`
        : `No layout map yet: the row is kept as sent · ${readFacts}`,
    },
    {
      stage: "Status word",
      state: outcome?.heldWord ? "needs" : commissionFile ? "none" : snap?.statusRaw ? "done" : "none",
      text: commissionFile && !outcome?.heldWord ? "Not needed: a commission line has no policy status"
        : outcome?.heldWord ? `“${outcome.heldWord}” isn't mapped yet: held until Insurvas maps it`
          : snap?.statusRaw ? `“${snap.statusRaw}” → ${words(snap.status) || "not mapped"}` : "No status in this row",
    },
    {
      stage: "Linked",
      state: outcome?.reviewId ? "needs" : (outcome?.linkedBy && outcome.linkedBy !== "Not linked") || (commissionFile && policy) ? "done" : "none",
      text: outcome?.reviewId ? `Waits for you: ${outcome.reviewChoices ? `${outcome.reviewChoices} ${outcome.reviewChoices === 1 ? "sale could be it" : "sales could be it"}` : "no sale has this number"}`
        : outcome?.linkedBy && outcome.linkedBy !== "Not linked" ? `${outcome.clientName ?? "A client"} · ${outcome.linkedBy.toLowerCase()}${outcome.linkedAt ? ` · since ${fileDay(outcome.linkedAt.slice(0, 10))}` : ""}`
          : commissionFile ? (policy ? `Belongs to ${policy} by carrier and number` : "No policy") : "Not linked yet",
      // The Review page at this row's item (round 5): /app/policy-matching ignored ?review=, so the link opened the
      // whole queue. `from` brings Back here.
      action: outcome?.reviewId ? <Link href={pickClientHref(outcome.reviewId, rowHref(row.file.id, row.rowNumber))}>Pick the client</Link> : policyLink("client") ? <Link href={policyLink("client")!}>Change client</Link> : undefined,
    },
    {
      stage: changed ? "Changed" : "History",
      state: !commissionFile && (outcome?.outcome === "new" || changed) ? "done" : "none",
      text: commissionFile ? "Not needed: a commission line changes no policy"
        : outcome?.outcome === "new" ? "New policy: its history starts with this file"
          : outcome?.changes.length ? outcome.changes.map((c) => `${CHANGE_FIELD_LABELS[c.field] ?? c.field} ${changeValue(c.field, c.from)} → ${changeValue(c.field, c.to)}`).join(" · ")
            : row.snapshot ? "No change since the previous file" : "Nothing recorded",
      action: policyLink("history") && !commissionFile ? <Link href={policyLink("history")!}>History</Link> : undefined,
    },
    {
      stage: "Pipeline",
      state: outcome?.card ? "done" : "none",
      text: outcome?.card ? `The card moved ${outcome.card.from ?? "—"} → ${outcome.card.to}` : commissionFile ? "No card moves from a commission line" : "No card moved",
      action: outcome?.card && policyLink("pipeline") ? <Link href={policyLink("pipeline")!}>On the policy</Link>
        : !commissionFile && row.snapshot ? <Link href="/app/book-setup/pipeline-rules/new" title="No card-move rule moved this policy's card: add one">Add a rule</Link> : undefined,
    },
    {
      stage: "Commissions",
      state: row.lines.length ? "done" : "none",
      text: row.lines.length ? row.lines.map((l) => `${l.type.replaceAll("_", " ")} ${cents(l.amountCents)}${l.statementDate ? `, statement of ${fileDay(l.statementDate)}` : ""}`).join(" · ")
        : commissionFile ? "No commission line in this row" : "A policy file carries no commission lines",
      action: row.lines.length && policyLink("commissions") ? <Link href={policyLink("commissions")!}>Policy commissions</Link> : undefined,
    },
  ];

  const missing = row.missingFields.length
    ? `The map also reads ${row.missingFields.map((f) => `${f.targetField} from “${f.sourceColumn}”`).join(", ")}, and this file has no such column.`
    : null;

  // Walk 2026-11-06 (owner: "un-organised… you get lost where you entered"): one numbering everywhere (Row 1 of 8,
  // the file's line number only in a tooltip), a "This row" strip that answers what the row did before any stage,
  // the stages that did something first with their action as a row button, and the ones with nothing to do folded
  // into one muted line.
  const position = row.position ?? row.rowNumber;
  const rowWord = `Row ${position.toLocaleString("en-US")}${row.rowCount ? ` of ${row.rowCount.toLocaleString("en-US")}` : ""}`;
  const acted = steps.filter((step) => step.state !== "none");
  const idle = steps.filter((step) => step.state === "none");
  const linkedTo = outcome?.reviewId ? "Waits for you" : outcome?.linkedBy && outcome.linkedBy !== "Not linked" ? outcome.clientName ?? "Linked" : commissionFile && policy ? policy : "Not linked";
  const summary = commissionFile
    ? [
        { label: "Lines", value: row.lines.length.toLocaleString("en-US"), footnote: row.lines.map((l) => l.type.replaceAll("_", " ")).join(", ") || "none in this row" },
        { label: "Amount", value: row.lines.length ? cents(row.lines.reduce((sum, l) => sum + l.amountCents, 0)) : "—", footnote: row.lines[0]?.statementDate ? `statement of ${fileDay(row.lines[0].statementDate)}` : "this row" },
        { label: "Policy", value: policy ?? "—", footnote: linkedTo === policy ? "matched by carrier and number" : linkedTo },
      ]
    : [
        { label: "Status", value: snap?.status ? words(snap.status) : "—", footnote: snap?.statusRaw ? `carrier says “${snap.statusRaw}”` : "no status in this row" },
        { label: "Premium", value: snap?.premiumCents !== null && snap?.premiumCents !== undefined ? cents(snap.premiumCents) : "—", footnote: snap?.premiumMode ?? "not in this row" },
        { label: "Paid to", value: snap?.paidTo ? fileDay(snap.paidTo) : "—", footnote: "the carrier's paid-to date" },
        { label: "Client", value: linkedTo, footnote: outcome?.reviewId ? "pick the client below" : outcome?.linkedBy && outcome.linkedBy !== "Not linked" ? outcome.linkedBy.toLowerCase() : "no client yet" },
      ];

  return (
    <DataInPage
      step="files"
      title={title}
      breadcrumbs={[{ label: "Book of business", href: "/app/carrier-files" }, { label: "Carrier files", href: "/app/carrier-files" }, { label: row.file.name, href: fileHref(row.file.id) }, { label: rowWord }]}
      chip={outcome ? <StatusChip tone={ROW_OUTCOME_TONES[outcome.outcome]}>{ROW_OUTCOME_LABELS[outcome.outcome]}</StatusChip> : undefined}
      facts={
        <p className="m-0 mt-1 flex min-w-0 flex-wrap gap-x-1.5 text-sm leading-normal text-muted-foreground">
          <span title={`Line ${row.rowNumber} of the file as sent (line 1 is the header)`}>{rowWord} in</span>
          <Link href={fileHref(row.file.id)} className="text-[var(--accent-ink)] hover:underline" title="Back to the file">{row.file.name}</Link>
          <span>· {row.file.carrierName ?? "Carrier not known"} · file of {fileDay(row.file.fileDate)}</span>
        </p>
      }
      actions={<>
        {prev ? <Button asChild variant="outline"><Link href={prev} title="The row before this one">‹ Row</Link></Button> : <Button type="button" variant="outline" disabled title="This is the file's first row">‹ Row</Button>}
        {next ? <Button asChild variant="outline"><Link href={next} title="The row after this one">Row ›</Link></Button> : <Button type="button" variant="outline" disabled title="This is the file's last row">Row ›</Button>}
        {policyLink() ? <Button asChild><Link href={policyLink()!}>Open the policy</Link></Button> : <Button type="button" disabled title="This row made no policy">Open the policy</Button>}
      </>}
    >
      <StatStrip label="This row">
        {summary.map((tile) => <StatTile key={tile.label} label={tile.label} value={tile.value} footnote={tile.footnote} />)}
      </StatStrip>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <TableCard title="What happened" description={`${acted.length} of ${steps.length} steps did something for this row`}>
          <ol className="m-0 list-none border-t border-border p-0">
            {acted.map((step, index) => (
              <li key={step.stage} className="grid min-h-[2.75rem] grid-cols-[24px_112px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-4 py-2 text-sm">
                <span aria-hidden="true" className={cn("flex size-6 items-center justify-center rounded-full text-xs font-semibold", step.state === "needs" ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[var(--success-surface)] text-[var(--success-ink)]")}>{index + 1}</span>
                <span className="font-semibold text-foreground">{step.stage}<span className="sr-only"> · {DOT_SAID[step.state]}</span></span>
                <span className="min-w-0 whitespace-normal break-words leading-snug text-foreground">{step.text}</span>
                <span className="text-right">{step.action ? <Button asChild size="sm" variant={step.state === "needs" ? "default" : "outline"}>{step.action}</Button> : null}</span>
              </li>
            ))}
          </ol>
          {idle.length > 0 && (
            <p className="m-0 px-4 py-3 text-sm text-muted-foreground" title={idle.map((step) => `${step.stage}: ${typeof step.text === "string" ? step.text : ""}`).join("\n")}>
              Nothing to do for this row: {idle.map((step) => step.stage).join(", ")}
              {idle.find((step) => step.action) ? <> · {idle.filter((step) => step.action).map((step) => <span key={step.stage} className={linkWrap}>{step.action}</span>)}</> : null}
            </p>
          )}
        </TableCard>
        <RowAsSent entries={row.columns.map(asSent)} missing={missing} noMap={!row.map} />
      </div>
    </DataInPage>
  );
}
