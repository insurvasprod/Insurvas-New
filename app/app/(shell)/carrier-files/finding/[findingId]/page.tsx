import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
import { FindingDecide } from "@/components/app/book/files/finding-decide";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { listFindings } from "@/lib/ingestion/dailyRunStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileHref, findingHref } from "@/lib/ingestion/trace";

const SEVERITY: Record<string, { word: string; tone: StatusTone }> = { blocking: { word: "Blocking", tone: "danger" }, warning: { word: "Warning", tone: "warning" }, info: { word: "Note", tone: "neutral" } };
const STATUS_WORD: Record<string, string> = { open: "Open", approved: "Marked right", rejected: "Marked wrong", auto_resolved: "Resolved itself" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const LIST = "/app/carrier-files?show=needs";

/**
 * Book of business › Files › a problem found (walk 2026-11-03): what an agent raised in a run, on its own page,
 * with the one question — was it right? — and ‹ Problem › through the open ones, newest first as the list.
 * The list only lists and links (round 5: decisions never happen inside a table). Opening it writes nothing.
 */
export default async function FindingPage({ params }: { params: Promise<{ findingId: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files are received and managed by the account owner or a bookkeeper." />;
  const { findingId } = await params;
  if (!isRecordUuid(findingId)) notFound();
  // Frame first (UI-CONSISTENCY §7a): the trail, the stepper and the frame draw at once; the problem's name waits behind
  // its shape, and its status, facts and decision stream in.
  const read = listFindings(guard.context.tenantId).then((list) => {
    const finding = list.available ? list.findings.find((f) => f.id === findingId) ?? null : null;
    if (!finding) return null;
    const open = list.findings.filter((f) => f.status === "open");
    const at = open.findIndex((f) => f.id === finding.id);
    return { finding, open, at, severity: SEVERITY[finding.severity] ?? SEVERITY.info };
  });
  const readOnly = guard.entitlement.access === "read_only";

  return (
    <DataInPage
      step="files"
      title={<RecordName read={read.then((one) => one && `${one.severity.word}: ${one.finding.agentLabel}`)} />}
      chip={<Suspense fallback={null}><Chip read={read} /></Suspense>}
      facts={<Suspense fallback={null}><Facts read={read} /></Suspense>}
      breadcrumbs={[{ label: "Book of business", href: "/app/carrier-files" }, { label: "Carrier files", href: "/app/carrier-files" }, { label: "Problems found", href: LIST }, { label: "A problem", node: <RecordName read={read.then((one) => one?.finding.fileName ?? "A problem")} crumb /> }]}
      actions={<Suspense fallback={<Stepper />}><Steps read={read} /></Suspense>}
    >
      <StreamSection shape="cards" cards={2} rows={5}><Finding read={read} readOnly={readOnly} /></StreamSection>
    </DataInPage>
  );
}

type Read = Promise<{ finding: Awaited<ReturnType<typeof listFindings>>["findings"][number]; open: Awaited<ReturnType<typeof listFindings>>["findings"]; at: number; severity: { word: string; tone: StatusTone } } | null>;

async function Chip({ read }: { read: Read }) {
  const one = await read;
  if (!one) return null;
  return <StatusChip tone={one.finding.status === "open" ? one.severity.tone : "neutral"}>{STATUS_WORD[one.finding.status] ?? one.finding.status}</StatusChip>;
}

async function Facts({ read }: { read: Read }) {
  const one = await read;
  if (!one) return null;
  const { open, at } = one;
  return open.length ? `${at >= 0 ? `Problem ${at + 1} of ${open.length} open` : `${open.length} open`}` : "None open";
}

/** ‹ Problem and Problem ›: disabled until the open problems are known, and at either end. */
function Stepper({ prev = null, next = null }: { prev?: { id: string } | null; next?: { id: string } | null }) {
  return (
    <>
      {prev ? <Button asChild variant="outline"><Link href={findingHref(prev.id)}>‹ Problem</Link></Button> : <Button type="button" variant="outline" disabled title="This is the newest open problem">‹ Problem</Button>}
      {next ? <Button asChild variant="outline"><Link href={findingHref(next.id)}>Problem ›</Link></Button> : <Button type="button" variant="outline" disabled title="This is the oldest open problem">Problem ›</Button>}
    </>
  );
}

async function Steps({ read }: { read: Read }) {
  const one = await read;
  if (!one) return <Stepper />;
  const { open, at } = one;
  return <Stepper prev={at > 0 ? open[at - 1] : null} next={at >= 0 && at < open.length - 1 ? open[at + 1] : null} />;
}

async function Finding({ read, readOnly }: { read: Read; readOnly: boolean }) {
  const one = await read;
  if (!one) notFound();
  const { finding, open, at } = one;
  const nextOpen = open.filter((f) => f.id !== finding.id)[at >= 0 ? at : 0] ?? null;
  const facts = [
    { label: "Agent", value: <>{finding.agentLabel}<span className="block text-xs text-muted-foreground">{finding.modelId ? `${finding.modelId} · prompt ${finding.promptVersion}` : "No model: a fixed check"}</span></> },
    { label: "What it saw", value: finding.reasoning },
    { label: "File", value: finding.fileId ? <Link href={fileHref(finding.fileId)} className="font-medium text-[var(--accent-ink)] hover:underline">{finding.fileName ?? "The file"}</Link> : "No file: it is about the day" },
    ...(finding.confidence !== null ? [{ label: "Confidence", value: `${Math.round(finding.confidence * 100)}%` }] : []),
    { label: "When", value: when(finding.createdAt) },
  ];

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <TableCard title="What it saw">
        <dl className="m-0 border-t border-border">
          {facts.map((fact) => (
            <div key={fact.label} className="grid min-h-[2.75rem] grid-cols-[132px_minmax(0,1fr)] items-center gap-x-3 border-b border-border px-4 py-2 text-sm last:border-b-0">
              <dt className="font-semibold text-muted-foreground">{fact.label}</dt>
              <dd className="m-0 min-w-0 whitespace-normal break-words leading-snug text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </TableCard>
      <FindingDecide id={finding.id} open={finding.status === "open"} statusWord={STATUS_WORD[finding.status] ?? finding.status} nextHref={nextOpen ? findingHref(nextOpen.id) : null} doneHref={LIST} readOnly={readOnly} />
    </div>
  );
}
