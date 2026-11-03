"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, FileText, Languages, MessageSquare, Phone, UserRound } from "lucide-react";

import { stageLabel, stageTone, when } from "@/components/partner/lead-format";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { productLineLabel } from "@/lib/format/productLine";
import type { PartnerLeadDetail } from "@/lib/partnerLeads/types";
import type { SnapshotGroup } from "@/lib/partnerLeads/view";

function InformationGroup({ group }: { group: SnapshotGroup }) {
  return (
    <details open className="group min-w-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 outline-none transition-colors hover:bg-[var(--surface-alt)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-[&:not([open])]:-rotate-90" />
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{group.label}</span>
      </summary>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 px-4 pb-4 pl-10 sm:grid-cols-2 xl:grid-cols-4">
        {group.fields.map((field) => (
          <div key={field.key} className="min-w-0">
            <dt className="text-xs font-medium leading-4 text-muted-foreground">{field.label}</dt>
            <dd className="m-0 mt-1 break-words text-sm font-medium leading-5 text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Submission({ detail }: { detail: PartnerLeadDetail }) {
  const recordGroup: SnapshotGroup = {
    key: "submission",
    label: "Submission",
    fields: [
      { key: "submitted", label: "Submitted", value: when(detail.submittedAt) },
      { key: "submitted_by", label: "Submitted by", value: detail.submittedBy.name },
      { key: "last_update", label: "Last update", value: when(detail.updatedAt) },
      { key: "outcome", label: "Outcome", value: detail.outcome ?? "Awaiting update" },
    ],
  };
  const groups = [...detail.groups, recordGroup];
  return (
    <div id="partner-lead-overview" role="tabpanel" aria-labelledby="partner-lead-tab-overview" className="min-w-0 overflow-hidden rounded-lg border border-border bg-card outline-none">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="m-0 flex items-center gap-1.5 text-base font-semibold text-foreground">Application<InfoTip label="About this application">The form as it was submitted. It is view only; your agency works the lead from here.</InfoTip></h2>
      </div>
      {!detail.groups.length && <p className="m-0 border-b border-border px-4 py-8 text-center text-sm text-muted-foreground">Nothing was recorded on this submission.</p>}
      <div className="divide-y divide-border">
        {groups.map((group) => <InformationGroup key={group.key} group={group} />)}
      </div>
    </div>
  );
}

function CallUpdates({ detail }: { detail: PartnerLeadDetail }) {
  return (
    <div id="partner-lead-call-updates" role="tabpanel" aria-labelledby="partner-lead-tab-call-updates" className="min-w-0 rounded-lg border border-border bg-card p-4 outline-none">
      {!detail.timeline.length ? <p className="m-0 py-8 text-center text-sm text-muted-foreground">No call or status updates yet.</p> : (
        <ol className="m-0 flex list-none flex-col p-0">
          {detail.timeline.map((event, index) => (
            <li key={`${event.at}-${event.type}-${index}`} className="relative flex min-w-0 gap-3 pb-5 last:pb-0">
              <span className="relative z-10 mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-[var(--accent-ink)]">
                {event.type === "message" ? <MessageSquare aria-hidden="true" className="size-3.5" /> : <Phone aria-hidden="true" className="size-3.5" />}
              </span>
              {index < detail.timeline.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[13px] top-7 w-px bg-border" />}
              <div className="min-w-0 flex-1 border-b border-border/70 pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="m-0 text-sm font-semibold text-foreground">{event.label}</p>
                  <time className="text-xs tabular-nums text-muted-foreground">{when(event.at)}</time>
                </div>
                {event.detail && <p className="mb-0 mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-muted-foreground">{event.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SharedNotes({ detail }: { detail: PartnerLeadDetail }) {
  return (
    <div id="partner-lead-notes" role="tabpanel" aria-labelledby="partner-lead-tab-notes" className="min-w-0 rounded-lg border border-border bg-card p-4 outline-none">
      {!detail.notes.length ? <p className="m-0 py-8 text-center text-sm text-muted-foreground">No notes have been shared with you yet.</p> : (
        <ol className="m-0 list-none divide-y divide-border p-0">
          {detail.notes.map((note, index) => (
            <li key={`${note.at}-${index}`} className="grid min-w-0 gap-1 py-4 first:pt-1 last:pb-1">
              <time className="text-xs font-medium tabular-nums text-muted-foreground">{when(note.at)}</time>
              <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{note.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function PartnerLeadRecord({ detail, backHref }: { detail: PartnerLeadDetail; backHref: string }) {
  const [tab, setTab] = useState<"overview" | "call-updates" | "notes">("overview");
  const activePanel = tab === "overview" ? "partner-lead-overview" : tab === "call-updates" ? "partner-lead-call-updates" : "partner-lead-notes";
  const tabs = [
    { key: "overview", label: "Overview", marker: <UserRound aria-hidden="true" className="size-3.5" /> },
    { key: "call-updates", label: "Call updates", marker: <Phone aria-hidden="true" className="size-3.5" /> },
    { key: "notes", label: "Notes", marker: <FileText aria-hidden="true" className="size-3.5" /> },
  ] as const;
  return (
    <div className="m-stagger flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={detail.customer}
        description={`Submitted by ${detail.submittedBy.name}`}
        breadcrumbs={[{ label: "Lead Pipeline", href: backHref }, { label: detail.customer }]}
        meta={<div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusChip tone={stageTone(detail)}>{stageLabel(detail)}</StatusChip>
          <StatusChip tone="neutral" className="border border-border">{productLineLabel(detail.product)}</StatusChip>
          {detail.language && <StatusChip tone="neutral" className="border border-border"><span className="inline-flex items-center gap-1.5" aria-label={`Customer language: ${detail.language}`}><Languages aria-hidden="true" className="size-3.5" />{detail.language}</span></StatusChip>}
        </div>}
        actions={<div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <ViewTabs
            label="Lead information"
            tabs={tabs}
            value={tab}
            onChange={setTab}
            idPrefix="partner-lead-tab"
            controls={activePanel}
          />
          <Button asChild variant="outline" size="icon" title="Message your agent"><Link href="/partner/messages" aria-label="Message your agent"><MessageSquare aria-hidden="true" /></Link></Button>
        </div>}
      />
      {tab === "overview" ? <Submission detail={detail} /> : tab === "call-updates" ? <CallUpdates detail={detail} /> : <SharedNotes detail={detail} />}
    </div>
  );
}
