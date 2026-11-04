import Link from "next/link";
import { notFound } from "next/navigation";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FindingDecide } from "@/components/app/book/files/finding-decide";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
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
  const list = await listFindings(guard.context.tenantId);
  const finding = list.findings.find((f) => f.id === findingId);
  if (!list.available || !finding) notFound();

  const open = list.findings.filter((f) => f.status === "open");
  const at = open.findIndex((f) => f.id === finding.id);
  const prev = at > 0 ? open[at - 1] : null;
  const nextOpen = open.filter((f) => f.id !== finding.id)[at >= 0 ? at : 0] ?? null;
  const next = at >= 0 && at < open.length - 1 ? open[at + 1] : null;
  const severity = SEVERITY[finding.severity] ?? SEVERITY.info;
  const facts = [
    { label: "Agent", value: <>{finding.agentLabel}<span className="block text-xs text-muted-foreground">{finding.modelId ? `${finding.modelId} · prompt ${finding.promptVersion}` : "No model: a fixed check"}</span></> },
    { label: "What it saw", value: finding.reasoning },
    { label: "File", value: finding.fileId ? <Link href={fileHref(finding.fileId)} className="font-medium text-[var(--accent-ink)] hover:underline">{finding.fileName ?? "The file"}</Link> : "No file: it is about the day" },
    ...(finding.confidence !== null ? [{ label: "Confidence", value: `${Math.round(finding.confidence * 100)}%` }] : []),
    { label: "When", value: when(finding.createdAt) },
  ];

  return (
    <DataInPage
      step="files"
      title={`${severity.word}: ${finding.agentLabel}`}
      chip={<StatusChip tone={finding.status === "open" ? severity.tone : "neutral"}>{STATUS_WORD[finding.status] ?? finding.status}</StatusChip>}
      facts={open.length ? `${at >= 0 ? `Problem ${at + 1} of ${open.length} open` : `${open.length} open`}` : "None open"}
      breadcrumbs={[{ label: "Book of business", href: "/app/carrier-files" }, { label: "Files", href: "/app/carrier-files" }, { label: "Problems found", href: LIST }, { label: finding.fileName ?? "A problem" }]}
      actions={<>
        {prev ? <Button asChild variant="outline"><Link href={findingHref(prev.id)}>‹ Problem</Link></Button> : <Button type="button" variant="outline" disabled title="This is the newest open problem">‹ Problem</Button>}
        {next ? <Button asChild variant="outline"><Link href={findingHref(next.id)}>Problem ›</Link></Button> : <Button type="button" variant="outline" disabled title="This is the oldest open problem">Problem ›</Button>}
      </>}
    >
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
        <FindingDecide id={finding.id} open={finding.status === "open"} statusWord={STATUS_WORD[finding.status] ?? finding.status} nextHref={nextOpen ? findingHref(nextOpen.id) : null} doneHref={LIST} readOnly={guard.entitlement.access === "read_only"} />
      </div>
    </DataInPage>
  );
}
