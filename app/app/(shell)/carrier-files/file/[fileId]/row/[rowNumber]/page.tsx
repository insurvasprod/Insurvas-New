import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { fileDay } from "@/lib/ingestion/constants";
import { loadFileHead, loadRowStory } from "@/lib/ingestion/fileOutcomeStore";
import { CHANGE_FIELD_LABELS, ROW_OUTCOME_LABELS, ROW_OUTCOME_TONES, changeValue, policyHref } from "@/lib/ingestion/fileStages";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { loadRowTrace } from "@/lib/ingestion/traceStore";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { MoreMenu } from "@/components/app/book/files/more-menu";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Book of business › Files › a file › a row (LA-4.20, Notion sprint; round 2, owner 2026-11-02 — was a
 * side panel in round 1): one row of a carrier file as a detail page. What happened: each stage for this
 * one row in words, with the way to change its client, its policy's history and the card it moved. As
 * sent: every original column, the layout map version that read it and the field each became — the
 * screen that answers "did we read this right?" without a database client. Owner and bookkeeper.
 * Opening it writes nothing.
 *
 * Round 3 (owner 2026-11-02, docs/la4/POLISH-ROUND3.md): the file page's compact header — the outcome chip
 * beside the title, one muted line of facts under it, "Open the policy" with the previous and next rows and
 * the file in More.
 */
const cents = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const link = "font-semibold text-[var(--accent-ink)] hover:underline";
const words = (value: string | null) => (value ? value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "");

export default async function RawRowPage({ params, searchParams }: { params: Promise<{ fileId: string; rowNumber: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files, and the rows in them, are opened by the account owner or a bookkeeper." />;
  const { fileId, rowNumber } = await params;
  const n = Number(rowNumber);
  if (!isRecordUuid(fileId) || !Number.isInteger(n) || n < 1) notFound();
  const tenantId = guard.context.tenantId;
  const [row, head] = await Promise.all([loadRowTrace(tenantId, fileId, n), loadFileHead(tenantId, fileId)]);
  if (!row || !head) notFound();
  const tab = (await searchParams).tab === "sent" ? "sent" : "story";
  const story = await loadRowStory(tenantId, fileId, n);
  const outcome = story?.row ?? null;
  const policy = row.snapshot?.policyNumber ?? outcome?.policyNumber ?? row.lines[0]?.policyNumber ?? null;
  const carrierId = row.snapshot?.carrierId ?? row.lines[0]?.carrierId ?? head.carrierId;
  const policyLink = (tabName?: "client" | "history" | "pipeline" | "commissions") => (policy && carrierId ? policyHref(carrierId, policy, tabName) : null);
  const prev = row.prevRow !== null ? rowHref(row.file.id, row.prevRow) : null;
  const next = row.nextRow !== null ? rowHref(row.file.id, row.nextRow) : null;
  const read = row.columns.filter((c) => c.becameField);
  const unread = row.columns.filter((c) => !c.becameField);
  const here = `${rowHref(row.file.id, row.rowNumber)}`;
  const columnChip = (column: string) => <span className="inline-flex h-6 min-w-7 items-center justify-center rounded-md bg-[var(--surface-alt)] px-1.5 font-mono text-xs text-muted-foreground">{column}</span>;

  // ─── What happened: one line per stage, in words ─────────────────────────────────────────────
  const commissionFile = head.fileType === "commissions";
  const snap = story?.snapshot ?? null;
  const steps: Array<{ stage: string; text: ReactNode; action?: ReactNode }> = [
    { stage: "Uploaded", text: `${row.file.name} · file of ${fileDay(row.file.fileDate)}`, action: <Link href={fileHref(row.file.id)} className={link}>The file</Link> },
    { stage: "Layout", text: row.map ? `${row.map.name} v${row.map.version} · ${row.columns.length} columns, ${unread.length} kept unread` : "No layout map yet: the row is kept as sent" },
    {
      stage: "Read",
      text: row.snapshot
        ? `Policy ${row.snapshot.policyNumber}${snap?.premiumCents !== null && snap?.premiumCents !== undefined ? ` · ${cents(snap.premiumCents)}${snap.premiumMode ? ` ${snap.premiumMode}` : ""}` : ""}${snap?.paidTo ? ` · paid to ${fileDay(snap.paidTo)}` : ""}`
        : row.lines.length ? `${row.lines.length} commission ${row.lines.length === 1 ? "line" : "lines"} on ${row.lines[0].policyNumber}` : "Nothing read from this row",
    },
    {
      stage: "Status word",
      text: commissionFile && !outcome?.heldWord ? "Not needed: a commission line has no policy status"
        : outcome?.heldWord ? `“${outcome.heldWord}” isn't mapped yet: held until Insurvas maps it`
          : snap?.statusRaw ? `“${snap.statusRaw}” → ${words(snap.status) || "not mapped"}` : "No status in this row",
    },
    {
      stage: "Linked",
      text: outcome?.reviewId ? `Waits for you: ${outcome.reviewChoices ? `${outcome.reviewChoices} ${outcome.reviewChoices === 1 ? "sale could be it" : "sales could be it"}` : "no sale has this number"}`
        : outcome?.linkedBy && outcome.linkedBy !== "Not linked" ? `${outcome.clientName ?? "A client"} · ${outcome.linkedBy.toLowerCase()}${outcome.linkedAt ? ` · since ${fileDay(outcome.linkedAt.slice(0, 10))}` : ""}`
          : commissionFile ? (policy ? `Belongs to ${policy} by carrier and number` : "No policy") : "Not linked yet",
      action: outcome?.reviewId ? <Link href={`/app/policy-matching?review=${outcome.reviewId}`} className={link}>Pick the client</Link> : policyLink("client") ? <Link href={policyLink("client")!} className={link}>Change client</Link> : undefined,
    },
    {
      stage: "History",
      text: commissionFile ? "Not needed: a commission line changes no policy"
        : outcome?.outcome === "new" ? "New policy: its history starts with this file"
          : outcome?.changes.length ? outcome.changes.map((c) => `${CHANGE_FIELD_LABELS[c.field] ?? c.field} ${changeValue(c.field, c.from)} → ${changeValue(c.field, c.to)}`).join(" · ")
            : row.snapshot ? "No change since the previous file" : "Nothing recorded",
      action: policyLink("history") && !commissionFile ? <Link href={policyLink("history")!} className={link}>Policy history</Link> : undefined,
    },
    {
      stage: "Pipeline",
      text: outcome?.card ? `The card moved ${outcome.card.from ?? "—"} → ${outcome.card.to}` : commissionFile ? "No card moves from a commission line" : "No card moved",
      action: outcome?.card && policyLink("pipeline") ? <Link href={policyLink("pipeline")!} className={link}>On the policy</Link> : undefined,
    },
    {
      stage: "Commissions",
      text: row.lines.length ? row.lines.map((l) => `${l.type.replaceAll("_", " ")} ${cents(l.amountCents)}${l.statementDate ? `, statement of ${fileDay(l.statementDate)}` : ""}`).join(" · ") : "No commission line in this row",
      action: row.lines.length && policyLink("commissions") ? <Link href={policyLink("commissions")!} className={link}>Policy commissions</Link> : undefined,
    },
  ];

  return (
    <DataInPage
      step="files"
      title={`Row ${row.rowNumber}${policy ? ` · ${policy}` : ""}`}
      chip={outcome ? <StatusChip tone={ROW_OUTCOME_TONES[outcome.outcome]}>{ROW_OUTCOME_LABELS[outcome.outcome]}</StatusChip> : undefined}
      facts={
        <p className="m-0 mt-1 flex min-w-0 flex-wrap gap-x-1.5 text-sm leading-normal text-muted-foreground">
          <span><Link href={fileHref(row.file.id)} className="text-[var(--accent-ink)] hover:underline">{row.file.name}</Link> ·</span>
          <span>{row.file.carrierName ?? "Carrier not known"} · file of {fileDay(row.file.fileDate)}{row.position && row.rowCount ? " ·" : ""}</span>
          {row.position && row.rowCount ? <span>line {row.position.toLocaleString("en-US")} of {row.rowCount.toLocaleString("en-US")}</span> : null}
        </p>
      }
      actions={<>
        {policyLink() ? <Button asChild><Link href={policyLink()!}>Open the policy</Link></Button> : <Button type="button" disabled title="This row made no policy">Open the policy</Button>}
        <MoreMenu
          items={[
            ...(prev ? [{ label: `Previous row (${row.prevRow})`, href: prev }] : []),
            ...(next ? [{ label: `Next row (${row.nextRow})`, href: next }] : []),
            { label: "Open the file", href: fileHref(row.file.id) },
          ]}
        />
      </>}
    >
      <ViewTabs label="This row" value={tab} tabs={[{ key: "story", label: "What happened", href: here }, { key: "sent", label: "As sent", count: row.columns.length, href: `${here}?tab=sent` }]} />
      {tab === "story" ? (
        <TableCard>
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th className="w-[150px]">Stage</th><th>For this row</th><th className="w-[170px] text-right"><span className="sr-only">Where to change it</span></th></tr></thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.stage}>
                  <td className="font-semibold text-foreground">{step.stage}</td>
                  <td><span className="block whitespace-normal break-words leading-snug">{step.text}</span></td>
                  <td className="text-right">{step.action ?? null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : (
        <>
          <PagedTableCard total={read.length} noun="columns" title="Read by the layout" description="Each column the layout map reads, the field it fills and the value kept.">
            {read.length === 0 ? <EmptyState title="No column of this row is read" hint={row.map ? "The layout map reads none of this file's columns." : "The file has no layout map yet."} /> : (
              <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
                <thead><tr><th className="w-[70px]">Column</th><th className="w-[200px]">Header</th><th>Value as sent</th><th className="w-[230px]">Becomes</th><th>Kept as</th></tr></thead>
                <PagedBody>
                  {read.map((c) => (
                    <tr key={c.column + c.header}>
                      <td>{columnChip(c.column)}</td>
                      <td className="font-mono text-xs text-foreground">{c.header}</td>
                      <td className="max-w-[260px] truncate font-mono text-xs" title={c.value}>{c.value === "" ? <span className="font-sans text-muted-foreground">(empty)</span> : c.value}</td>
                      <td className="text-xs">
                        <StatusChip tone="info">{c.becameField}</StatusChip>
                        {c.dataType ? <span className="mt-1 block text-muted-foreground">{c.dataType}{c.transform && c.transform !== "none" ? ` · ${c.transform}` : ""}{c.required ? " · required" : ""}</span> : null}
                      </td>
                      <td className="max-w-[200px] truncate font-mono text-xs" title={c.stored ?? undefined}>{c.stored ?? (c.becameField?.startsWith("insured_") ? <span className="font-sans text-muted-foreground">Used to match the client, not kept on the policy</span> : <span className="text-muted-foreground">—</span>)}</td>
                    </tr>
                  ))}
                </PagedBody>
              </table>
            )}
            {row.missingFields.length > 0 && (
              <p className="m-0 border-t border-border px-4 py-3 text-xs text-[var(--warning-ink)]">
                The map also reads {row.missingFields.map((f) => `${f.targetField} from “${f.sourceColumn}”`).join(", ")}, and this file has no such column.
              </p>
            )}
          </PagedTableCard>

          {unread.length > 0 && (
            <PagedTableCard total={unread.length} noun="columns" title="Kept, not read" description={row.snapshot ? "Columns the layout doesn't read, kept with the row and the policy snapshot." : "Columns the layout doesn't read, kept with the row."}>
              <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
                <thead><tr><th className="w-[70px]">Column</th><th className="w-[260px]">Header</th><th>Value as sent</th></tr></thead>
                <PagedBody>
                  {unread.map((c) => (
                    <tr key={c.column + c.header}>
                      <td>{columnChip(c.column)}</td>
                      <td className="font-mono text-xs text-foreground">{c.header}</td>
                      <td className="max-w-[420px] truncate font-mono text-xs" title={c.value}>{c.value === "" ? <span className="font-sans text-muted-foreground">(empty)</span> : c.value}</td>
                    </tr>
                  ))}
                </PagedBody>
              </table>
            </PagedTableCard>
          )}
        </>
      )}
    </DataInPage>
  );
}
