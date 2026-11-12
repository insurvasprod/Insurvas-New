import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { personName } from "@/lib/format/personName";
import { isRecordUuid } from "@/lib/ingestion/path";
import { CARRIER_METHOD_LABELS, FIELD_LABELS, REQUEST_LABELS, describeChange, type Origin } from "@/lib/retention/servicing";
import { loadRequest, loadServicing, type ServicingRequest } from "@/lib/retention/servicingStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { ServicingRequestActions, ServicingRequestShell, StepButton } from "@/components/app/retention/servicing-request-view";
import { NoteBox } from "@/components/app/retention/note-box";
import {
  CHANGE_NOUN, asServicingView, bucketOf, canCancel, dayText, fileCheckText, localDay, phoneText, policyHref, requestHref, rowsInView, tryAgainHref, waitedDays,
  type Bucket,
} from "@/components/app/retention/servicing-shared";
import { buttonVariants } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { FactTable } from "@/components/ui/fact-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Waiting on the carrier › a request (LA-5.4; round 7, owner pick 2·1, 2026-11-10). The title is the
 * client's name alone; Request · Policy · History are the tabs on its line (`?tab=`). The title line's buttons are
 * ‹ previous and next › naming the neighbours' clients in the list's order (the tab it was opened from, `?from=`),
 * then the primary by state (Send it → Mark sent, Check it → Check it, Not in the file → Try again) and ⋯ (Cancel
 * the request, Open the policy, Open the case). Request: a strip of figures, then "Where it stands". Mark sent,
 * Check it and Cancel are dialogs (servicing-request-view.tsx); `?step=` opens one on arrival.
 * The same gates and the same visibility as the list; opening it checks an open request against the latest file.
 */
type Tab = "request" | "policy" | "history";

const ORIGIN_WORDS: Record<Origin, string> = { save_queue: "Save queue", retention_board: "Retention case", client_request: "Client asked", campaign: "Paper-bill campaign" };

export default async function ServicingRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; step?: string; from?: string }> }) {
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Waiting on the carrier" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Waiting on the carrier" detail="Only owners, producers and retention reps can open servicing requests." />;
  }
  const { id } = await params;
  if (!isRecordUuid(id)) notFound();
  const { tab: askedTab, step: askedStep, from: askedFrom } = await searchParams;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  // The list only for ‹ ›: loadRequest checks this request's files itself.
  const [r, list] = await Promise.all([loadRequest(viewer, id), loadServicing(viewer, { verify: false })]);
  if (!r) notFound();

  const tab: Tab = askedTab === "policy" || askedTab === "history" ? askedTab : "request";
  const name = r.clientName ? personName(r.clientName) : "No client linked";
  const today = localDay();
  const bucket = bucketOf(r, today);
  const from = asServicingView(askedFrom);

  // ‹ › walk the tab it was opened from, in the list's order; a request a step has moved out of it walks its own tab.
  const rows = list.available ? list.rows : [];
  const walk = rowsInView(rows, from, today).some((row) => row.id === r.id) ? from : bucket;
  const order = rowsInView(rows, walk, today);
  const at = order.findIndex((row) => row.id === r.id);
  const previous = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const neighbour = (row: { clientName: string | null }) => (row.clientName ? personName(row.clientName) : "No client linked");

  // `?step=` (the old links) opens its dialog on arrival, only when the request can take it now and never read-only.
  const initial = readOnly ? null
    : (askedStep === "submitted" || askedStep === "send") && bucket === "send" ? "send" as const
      : (askedStep === "check" || askedStep === "awaiting_carrier" || askedStep === "confirmed_by_carrier") && (bucket === "check" || bucket === "waiting") ? "check" as const
        : askedStep === "cancel" && canCancel(r.status) ? "cancel" as const
          : null;
  const primary = bucket === "send" ? "send" as const : bucket === "check" ? "check" as const : bucket === "failed" ? "failed" as const : null;

  const events = historyOf(r);
  const tabs = (
    <ViewTabs label={name} value={tab} tabs={[
      { key: "request" as const, label: "Request", href: requestHref(r.id, from) },
      { key: "policy" as const, label: "Policy", href: requestHref(r.id, from, "policy") },
      { key: "history" as const, label: "History", count: events.length, href: requestHref(r.id, from, "history") },
    ]} />
  );
  const actions = (
    <span className="inline-flex flex-wrap items-center gap-2">
      {previous && <Link href={requestHref(previous.id, walk, tab)} className={buttonVariants({ variant: "outline" })} title={`Previous request: ${neighbour(previous)}`}><ChevronLeft aria-hidden="true" />{neighbour(previous)}</Link>}
      {next && <Link href={requestHref(next.id, walk, tab)} className={buttonVariants({ variant: "outline" })} title={`Next request: ${neighbour(next)}`}>{neighbour(next)}<ChevronRight aria-hidden="true" /></Link>}
      <ServicingRequestActions
        primary={primary}
        tryAgainHref={tryAgainHref(r)}
        policyHref={policyHref(r)}
        caseHref={r.caseId ? `/app/retention/${r.caseId}` : null}
        cancellable={canCancel(r.status)}
        readOnly={readOnly}
      />
    </span>
  );
  const change = r.changes.map((c) => describeChange(c)).join(" · ");

  return (
    <ServicingRequestShell
      request={{
        id: r.id, name, status: r.status, carrierName: r.carrierName, change: change ? `${REQUEST_LABELS[r.type]} → ${change}` : REQUEST_LABELS[r.type],
        kind: `${REQUEST_LABELS[r.type].toLowerCase()} change`,
        carrierMethod: r.carrierMethod, carrierReference: r.carrierReference, formRef: r.formRef, expectedEffectiveDate: r.expectedEffectiveDate,
      }}
      back={requestHref(r.id, from, tab)}
      initial={initial}
    >
      <RetentionPage step="servicing" title={name} breadcrumbs={retentionTrail("servicing", name)} tabs={tabs} actions={actions}>
        {tab === "policy" ? <PolicyTab r={r} />
          : tab === "history" ? <HistoryTab r={r} events={events} readOnly={readOnly} />
            : <RequestTab r={r} bucket={bucket} readOnly={readOnly} />}
      </RetentionPage>
    </ServicingRequestShell>
  );
}

/** Request: the strip of figures (each linked where it leads somewhere), then where it stands. */
function RequestTab({ r, bucket, readOnly }: { r: ServicingRequest; bucket: Bucket; readOnly: boolean }) {
  const change = r.changes.map((c) => describeChange(c)).join(" · ");
  const sentHow = [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, r.carrierReference ? `ref ${r.carrierReference}` : null, r.formRef ? `form ${r.formRef}` : null].filter(Boolean).join(" · ");
  const waited = waitedDays(r);
  const fileDate = r.verifiedSnapshotDate ?? r.checkedSnapshotDate;
  const fileLine = r.status === "verified_in_file" ? "shows the change"
    : r.status === "failed" ? "doesn't show it"
      : r.unprovable.length ? `doesn't carry the ${r.unprovable.map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, " ")).join(" or ")}`
        : fileDate ? "doesn't show it yet" : "none since it was sent";
  const said = r.status === "confirmed_by_carrier" || r.confirmedAt ? { value: "Done", chip: "Not in a file yet", foot: r.confirmedAt ? `told on ${dayText(r.confirmedAt)}` : "what you were told" }
    : r.status === "awaiting_carrier" ? { value: "On it", chip: null, foot: r.carrierReference ? `ref ${r.carrierReference}` : "no reference given" }
      : { value: "Not asked", chip: null, foot: r.submittedAt ? "nothing recorded yet" : "not sent yet" };

  return (
    <div className="flex flex-col gap-4 lg:flex-1">
      <StatStrip label={`${REQUEST_LABELS[r.type]} request at a glance`}>
        <StatTile label="Change" valueSize="text" value={REQUEST_LABELS[r.type]} footnote={change || "—"} />
        {/* Plain strip (owner 2026-11-11): a tile that is a problem says so in one chip in its footnote. */}
        <StatTile label="Sent" valueSize="text" value={dayText(r.submittedAt) ?? "Not sent yet"} footnote={r.submittedAt ? sentHow || "how not recorded" : <StatusChip tone="warning">{waited !== null ? `Saved ${waited} ${waited === 1 ? "day" : "days"} ago` : "Never sent"}</StatusChip>} />
        <StatTile label="Carrier says" valueSize="text" value={said.value} footnote={said.chip ? <StatusChip tone="warning" title={said.foot}>{said.chip}</StatusChip> : said.foot} />
        <StatTile label="Latest file" valueSize="text" value={dayText(fileDate) ?? "None yet"} href={policyHref(r)} footnote={r.status === "failed" ? <StatusChip tone="danger">Doesn&apos;t show it</StatusChip> : fileLine} />
        <StatTile label="From" valueSize="text" value={r.caseId ? "Retention case" : ORIGIN_WORDS[r.origin]} href={r.caseId ? `/app/retention/${r.caseId}` : undefined} footnote={r.requestedBy ? `asked by ${r.requestedBy}` : "opened by Insurvas"} />
      </StatStrip>
      <WhereItStands r={r} bucket={bucket} readOnly={readOnly} />
    </div>
  );
}

type Rung = { label: string; state: "done" | "now" | "failed" | "ahead" | "skipped"; when?: string | null; line?: { text: string }; action?: ReactNode };

/** Where it stands (2·1): agree it with the client, send it to the carrier, the next file shows it. */
function WhereItStands({ r, bucket, readOnly }: { r: ServicingRequest; bucket: Bucket; readOnly: boolean }) {
  const check = fileCheckText(r);
  const sentHow = [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, r.carrierReference ? `ref ${r.carrierReference}` : null].filter(Boolean).join(", ");
  const cancelled = r.status === "cancelled";
  const rungs: Rung[] = [
    { label: "Agree the change with the client", state: "done", when: dayText(r.createdAt), line: r.requestedBy ? { text: `By ${r.requestedBy}` } : undefined },
    r.submittedAt
      ? { label: "Send the change to the carrier", state: "done", when: dayText(r.submittedAt), line: sentHow ? { text: sentHow } : undefined }
      : cancelled ? { label: "Send the change to the carrier", state: "skipped", line: { text: "Never sent" } }
        : { label: "Send the change to the carrier", state: "now", line: { text: "Saved, never sent: mark it sent once you have asked the carrier." }, action: readOnly ? null : <StepButton step="send" label="Mark sent" size="sm" /> },
  ];
  const third = `The next file shows ${CHANGE_NOUN[r.type]}`;
  if (r.status === "verified_in_file") rungs.push({ label: third, state: "done", when: dayText(r.verifiedAt), line: check ? { text: check.text } : undefined });
  else if (r.status === "failed") rungs.push({ label: third, state: "failed", when: dayText(r.failedAt), line: check ? { text: check.text } : undefined, action: readOnly ? null : <Link href={tryAgainHref(r)} className={buttonVariants({ size: "sm" })}>Try again</Link> });
  else if (cancelled) rungs.push({ label: third, state: "skipped", when: dayText(r.cancelledAt), line: { text: "Cancelled: nothing more is asked of the carrier." } });
  else if (bucket === "check") rungs.push({ label: third, state: "now", line: { text: `${check?.text ?? "The file doesn't show it"}: check it with the carrier and record what they said.` }, action: readOnly ? null : <StepButton step="check" label="Check it" size="sm" /> });
  else if (bucket === "waiting") rungs.push({ label: third, state: "now", line: check ? { text: check.text } : undefined, action: readOnly ? null : <StepButton step="check" label="Check it" size="sm" variant="outline" /> });
  else rungs.push({ label: third, state: "ahead" });

  return (
    <section className={`${cardSurface} flex flex-col lg:flex-1`} aria-labelledby="where-it-stands">
      <h2 id="where-it-stands" className="m-0 px-5 pt-4 pb-2 text-base font-semibold text-foreground">Where it stands</h2>
      <ol className="m-0 list-none p-0">
        {rungs.map((rung, i) => (
          <li key={rung.label} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 border-t border-border px-5 py-3">
            <span aria-hidden="true" className={`mt-0.5 grid size-6 place-items-center rounded-full text-xs font-bold ${
              rung.state === "done" ? "bg-[var(--success-surface)] text-[var(--success-ink)]"
                : rung.state === "failed" ? "bg-[var(--error-surface)] text-[var(--error-ink)]"
                  : rung.state === "now" ? "bg-[var(--primary)] text-[var(--on-primary)]"
                    : "border border-border text-muted-foreground"}`}>
              {rung.state === "done" ? <Check className="size-3.5" /> : rung.state === "failed" ? <X className="size-3.5" /> : i + 1}
            </span>
            <div className="min-w-0">
              <span className={`text-sm ${rung.state === "now" ? "font-semibold text-foreground" : rung.state === "ahead" || rung.state === "skipped" ? "text-muted-foreground" : "text-foreground"}`}>{rung.label}</span>
              {rung.when && <span className="text-xs text-muted-foreground tabular-nums"> · {rung.when}</span>}
              {rung.line && <p className="m-0 mt-0.5 text-xs text-muted-foreground">{rung.line.text}</p>}
            </div>
            <div>{rung.action}</div>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-auto border-t border-border px-5 py-3 text-xs text-muted-foreground">A request closes only when a carrier file shows the change.</p>
    </section>
  );
}

/** Policy: what the request changes, on which policy, for whom. */
function PolicyTab({ r }: { r: ServicingRequest }) {
  const rows: Array<[string, ReactNode]> = [
    ["Client", r.clientName ? personName(r.clientName) : "No client linked"],
    ["Phone", r.phone ? phoneText(r.phone) : null],
    ["Carrier", r.carrierName],
    ["Policy", <Link key="policy" href={policyHref(r)} className="font-semibold text-[var(--accent-ink)] hover:underline">{r.policyNumber} ›</Link>],
    ["What changes", r.changes.length ? <ul key="changes" className="m-0 grid list-none gap-1 p-0">{r.changes.map((c) => <li key={c.field}>{describeChange(c)}</li>)}</ul> : REQUEST_LABELS[r.type]],
    ["Why", r.targetDraftReason],
    ["From", r.caseId ? <Link key="case" href={`/app/retention/${r.caseId}`} className="font-semibold text-[var(--accent-ink)] hover:underline">Retention case ›</Link> : ORIGIN_WORDS[r.origin]],
  ];
  return (
    <section className={`${cardSurface} p-5 lg:flex-1`} aria-label="The policy">
      <FactTable rows={rows} labelWidth={220} className="max-w-[860px]" />
    </section>
  );
}

type Event = { when: string; label: string; line: string | null };

/** Every dated step of the request, oldest first. */
function historyOf(r: ServicingRequest): Event[] {
  const events: Array<Event | null> = [
    { when: r.createdAt, label: "Asked", line: r.requestedBy ? `By ${r.requestedBy}` : "Opened by Insurvas" },
    r.submittedAt ? { when: r.submittedAt, label: "Sent to the carrier", line: [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, r.carrierReference ? `ref ${r.carrierReference}` : null, r.formRef ? `form ${r.formRef}` : null, r.expectedEffectiveDate ? `takes effect by ${dayText(r.expectedEffectiveDate)}` : null].filter(Boolean).join(" · ") || null } : null,
    r.confirmedAt ? { when: r.confirmedAt, label: "Carrier says done", line: "What you were told; only a carrier file closes it." } : null,
    r.verifiedAt ? { when: r.verifiedAt, label: "In the file", line: r.verifiedSnapshotDate ? `The file of ${dayText(r.verifiedSnapshotDate)}` : null } : null,
    r.failedAt ? { when: r.failedAt, label: "Not in the file", line: r.failureReason ?? "The carrier file doesn't show the change." } : null,
    r.cancelledAt ? { when: r.cancelledAt, label: "Cancelled", line: null } : null,
  ];
  return events.filter((e): e is Event => e !== null).sort((a, b) => a.when.localeCompare(b.when));
}

/** History: the dated steps, then the notes (a note is added here, saved on its own). */
function HistoryTab({ r, events, readOnly }: { r: ServicingRequest; events: Event[]; readOnly: boolean }) {
  return (
    <section className={`${cardSurface} flex flex-col gap-4 p-5 lg:flex-1`} aria-label="History">
      <ol className="m-0 grid list-none gap-3 p-0">
        {events.map((e) => (
          <li key={`${e.label}-${e.when}`} className="grid grid-cols-[120px_auto_minmax(0,1fr)] items-baseline gap-3 text-sm">
            <span className="whitespace-nowrap text-muted-foreground tabular-nums">{dayText(e.when)}</span>
            <span className="whitespace-nowrap font-medium text-foreground">{e.label}</span>
            {/* One line per step (owner 2026-11-11): the detail is plain, its whole text the tooltip. */}
            {e.line ? <span className="truncate text-foreground" title={e.line}>{e.line}</span> : <span />}
          </li>
        ))}
      </ol>
      <div className="border-t border-border pt-4">
        <h2 className="m-0 text-sm font-semibold text-foreground">Notes</h2>
        <p className="m-0 mt-2 whitespace-pre-wrap text-sm text-foreground">{r.note?.trim() ? r.note : <span className="text-muted-foreground">No notes yet</span>}</p>
      </div>
      {!readOnly && <div className="border-t border-border pt-4"><NoteBox endpoint="/api/app/retention/servicing" fields={{ action: "note", id: r.id }} id="request-note" /></div>}
    </section>
  );
}
