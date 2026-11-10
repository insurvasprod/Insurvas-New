import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { personName } from "@/lib/format/personName";
import { isRecordUuid } from "@/lib/ingestion/path";
import { CARRIER_METHOD_LABELS, NEXT_STEPS, REQUEST_LABELS, describeChange } from "@/lib/retention/servicing";
import { loadRequest, type ServicingRequest } from "@/lib/retention/servicingStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { ServicingRequestActions, ServicingStepForm } from "@/components/app/retention/servicing-request-view";
import { NoteBox } from "@/components/app/retention/note-box";
import { TONE_CLASS, canCancel, dayText, fileCheckText, isFormStep, nextStepOf } from "@/components/app/retention/servicing-shared";
import { cardSurface } from "@/components/ui/card";
import { FactTable } from "@/components/ui/fact-table";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Servicing › a request (LA-5.4; SvA 2026-11-05, was a side panel and a step pop-up). The title is
 * the client with the request's status, one line of facts, the next step and More; the tabs are Progress (the
 * ladder from asked to in the file, and the step's form beside it on `?step=`), Change and Notes.
 * The same gates and the same visibility as the list; opening it checks an open request against the latest file.
 */
type Tab = "progress" | "change" | "notes";

export default async function ServicingRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; step?: string }> }) {
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Servicing" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Servicing" detail="Only owners, producers and retention reps can open servicing requests." />;
  }
  const { id } = await params;
  if (!isRecordUuid(id)) notFound();
  const { tab: askedTab, step: askedStep } = await searchParams;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  const r = await loadRequest(viewer, id);
  if (!r) notFound();

  const tab: Tab = askedTab === "change" || askedTab === "notes" ? askedTab : "progress";
  const name = r.clientName ? personName(r.clientName) : "No client linked";
  const next = nextStepOf(r.status);
  // A step from the address opens only when the request can take it now, and never read-only.
  const step = !readOnly && tab === "progress" && isFormStep(askedStep) && NEXT_STEPS[r.status].includes(askedStep) ? askedStep : null;
  const base = `/app/servicing/${r.id}`;
  // Under the name, one short line (owner 2026-11-06): what changes and on which policy; where it stands is the
  // Progress ladder below, not a chip by the name; the asked date and who asked are on it too.
  const line = [REQUEST_LABELS[r.type], `${r.carrierName} ${r.policyNumber}`].join(" · ");
  // The case it was opened from, so the request leads back to the work (critique E3).
  const facts = r.caseId ? <>{line} · <Link href={`/app/retention/${r.caseId}`} className="font-semibold text-[var(--accent-ink)] hover:underline">From a Retention case</Link></> : line;

  return (
    <RetentionPage
      step="servicing"
      title={name}
      facts={facts}
      breadcrumbs={retentionTrail("servicing", name)}
      tabs={<ViewTabs label={name} value={tab} tabs={[
        { key: "progress", label: "Progress", href: base },
        { key: "change", label: "Change", href: `${base}?tab=change` },
        { key: "notes", label: "Notes", href: `${base}?tab=notes` },
      ]} />}
      actions={readOnly ? undefined : (
        <ServicingRequestActions
          id={r.id} name={name} next={next} cancellable={canCancel(r.status)} failed={r.status === "failed"}
          carrierId={r.carrierId} policyNumber={r.policyNumber} type={r.type}
        />
      )}
    >
      {tab === "change" ? <ChangeTab r={r} />
        : tab === "notes" ? (
          <section className={`${cardSurface} flex flex-col gap-4 p-5 lg:flex-1`}>
            <div>
              <h2 className="m-0 text-sm font-semibold text-foreground">Notes</h2>
              <p className="m-0 mt-2 whitespace-pre-wrap text-sm text-foreground">{r.note?.trim() ? r.note : <span className="text-muted-foreground">No notes yet</span>}</p>
            </div>
            {!readOnly && <div className="border-t border-border pt-4"><NoteBox endpoint="/api/app/retention/servicing" fields={{ action: "note", id: r.id }} id="request-note" /></div>}
          </section>
        ) : (
          // Grows to the foot of the screen (owner 2026-11-06: "fill the full height, no gaps").
          <div className={step ? "grid gap-4 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]" : "flex flex-col lg:flex-1"}>
            <Timeline r={r} />
            {step && <ServicingStepForm key={step} id={r.id} to={step} type={r.type} carrierMethod={r.carrierMethod} carrierReference={r.carrierReference} expectedEffectiveDate={r.expectedEffectiveDate} />}
          </div>
        )}
    </RetentionPage>
  );
}

type Rung = { label: string; state: "done" | "failed" | "waiting" | "skipped" | "ahead"; when: string | null; lines: Array<{ text: string; tone?: keyof typeof TONE_CLASS }> };

/** The ladder: Asked → Sent to the carrier → Carrier is on it → Carrier says done → In the file. */
function Timeline({ r }: { r: ServicingRequest }) {
  const closed = r.status === "verified_in_file" || r.status === "failed";
  const pastOnIt = r.status === "confirmed_by_carrier" || closed;
  const check = fileCheckText(r);
  const rungs: Rung[] = [
    { label: "Asked", state: "done", when: dayText(r.createdAt), lines: [{ text: r.requestedBy ? `By ${r.requestedBy}` : "Opened by Insurvas" }] },
    {
      label: "Sent to the carrier", state: r.submittedAt ? "done" : closed ? "skipped" : "ahead", when: dayText(r.submittedAt),
      lines: r.submittedAt ? [
        { text: [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, r.carrierReference ? `Ref ${r.carrierReference}` : null, r.formRef ? `Form ${r.formRef}` : null].filter(Boolean).join(" · ") },
        ...(r.expectedEffectiveDate ? [{ text: `Takes effect by ${dayText(r.expectedEffectiveDate)}` }] : []),
      ].filter((l) => l.text) : [{ text: "Not sent yet" }],
    },
    {
      label: "Carrier is on it", state: r.status === "awaiting_carrier" ? "done" : pastOnIt ? "skipped" : "ahead", when: null,
      lines: r.status === "awaiting_carrier" ? (r.carrierReference ? [{ text: `Ref ${r.carrierReference}` }] : []) : pastOnIt ? [{ text: "Not recorded" }] : [],
    },
    {
      label: "Carrier says done", state: r.confirmedAt ? "done" : closed ? "skipped" : "ahead", when: dayText(r.confirmedAt),
      lines: r.confirmedAt ? [{ text: "What you were told; only a carrier file closes it." }] : closed ? [{ text: "Not recorded" }] : [],
    },
    {
      label: "In the file", state: r.status === "verified_in_file" ? "done" : r.status === "failed" ? "failed" : r.submittedAt && r.status !== "cancelled" ? "waiting" : "ahead",
      when: r.status === "verified_in_file" ? dayText(r.verifiedAt) : r.status === "failed" ? dayText(r.failedAt) : null,
      lines: check && r.status !== "cancelled" ? [{ text: check.text, tone: check.tone }] : [],
    },
  ];
  if (r.status === "cancelled") rungs.push({ label: "Cancelled", state: "done", when: dayText(r.cancelledAt), lines: [] });

  const DOT: Record<Rung["state"], string> = {
    done: "bg-[var(--success-ink)] border-transparent",
    failed: "bg-[var(--error-ink)] border-transparent",
    waiting: "border-[var(--warning-ink)] bg-card",
    skipped: "border-border bg-[var(--surface-alt)]",
    ahead: "border-border bg-card",
  };
  return (
    <section className={`${cardSurface} p-5 lg:flex-1`} aria-label="Progress">
      <ol className="m-0 grid list-none gap-0 p-0">
        {rungs.map((rung, i) => (
          <li key={rung.label} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
            {i < rungs.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-border" />}
            <span aria-hidden="true" className={`relative mt-1 size-4 rounded-full border-2 ${DOT[rung.state]}`} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`text-sm font-semibold ${rung.state === "ahead" || rung.state === "skipped" ? "text-muted-foreground" : "text-foreground"}`}>{rung.label}</span>
                {rung.when && <span className="text-xs text-muted-foreground tabular-nums">{rung.when}</span>}
                {rung.state === "waiting" && <span className="text-xs text-[var(--warning-ink)]">Waiting on the file</span>}
              </div>
              {rung.lines.map((line, n) => <p key={n} className={`m-0 mt-0.5 text-sm ${TONE_CLASS[line.tone ?? "muted"]}`}>{line.text}</p>)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChangeTab({ r }: { r: ServicingRequest }) {
  const rows: Array<[string, ReactNode]> = ([
    ["What changes", r.changes.length ? <ul className="m-0 grid list-none gap-1 p-0">{r.changes.map((c) => <li key={c.field}>{describeChange(c)}</li>)}</ul> : "—"],
    ["Why", r.targetDraftReason],
    ["How it went to the carrier", r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : "Not sent yet"],
    ["Carrier reference", r.carrierReference],
    ["Form used", r.formRef],
    ["Due by", r.expectedEffectiveDate ? dayText(r.expectedEffectiveDate) : null],
    ["Carrier said done", r.confirmedAt ? dayText(r.confirmedAt) : null],
  ] as Array<[string, ReactNode]>).filter(([, v]) => v !== null && v !== undefined && v !== "");
  // The change as a table (owner 2026-11-06), the same shape as a case's facts.
  return (
    <section className={`${cardSurface} p-5 lg:flex-1`} aria-label="The change">
      <FactTable rows={rows} labelWidth={220} className="max-w-[860px]" />
    </section>
  );
}
