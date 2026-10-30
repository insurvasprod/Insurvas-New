"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, MessageSquare } from "lucide-react";

import { stageLabel, stageTone, when } from "@/components/partner/lead-format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { productLineLabel } from "@/lib/format/productLine";
import type { PartnerLeadDetail } from "@/lib/partnerLeads/types";
import { laneOf, progressSteps, snapshotFields } from "@/lib/partnerLeads/view";
import { cn } from "@/lib/utils";

/** The strip at the top of the record: what has happened, what it is waiting on, what is ahead. */
function Progress({ detail }: { detail: PartnerLeadDetail }) {
  const steps = progressSteps(laneOf(detail));
  const dated = (event: string | null) => event ? detail.timeline.find((item) => item.type === event)?.at ?? null : null;
  return <ol aria-label="Progress" className="flex min-w-0 list-none flex-wrap gap-x-1 gap-y-2 p-0">
    {steps.map((step, index) => {
      const at = dated(step.event);
      return <li key={step.key} className="flex min-w-0 flex-1 basis-[7rem] flex-col gap-1.5">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className={cn(
            "size-2 shrink-0 rounded-full",
            step.state === "done" ? "bg-[var(--primary)]" : step.state === "current" ? "bg-[var(--warning)]" : "bg-[var(--border)]",
          )} />
          {index < steps.length - 1 && <span className={cn("h-px min-w-0 flex-1", step.state === "done" ? "bg-[var(--primary)]" : "bg-[var(--border)]")} />}
        </span>
        <span className="min-w-0">
          <span className={cn("block truncate text-xs font-medium", step.state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
            {step.label}
            {step.state === "current" && <span className="sr-only"> — where it is now</span>}
          </span>
          {/* Only where the records can date it: "On a call" has no event of its own. */}
          <span className="block truncate text-[0.6875rem] text-muted-foreground">{at ? when(at) : "\u00a0"}</span>
        </span>
      </li>;
    })}
  </ol>;
}

/** The form as it was sent: grouped, ordered and formatted (lib/partnerLeads/view.ts). */
function Submission({ detail }: { detail: PartnerLeadDetail }) {
  const groups = snapshotFields(detail.values);
  return <div className="flex min-w-0 flex-col gap-4">
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
      Form as submitted — cannot be edited in the partner portal
    </p>
    {groups.map((group) => <section key={group.key} className="min-w-0">
      <h3 className="mb-1.5 text-label text-muted-foreground">{group.label}</h3>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1.5 text-sm">
        {group.fields.map((field) => <Fragment key={field.key}>
          <dt className="min-w-0 truncate text-muted-foreground">{field.label}</dt>
          <dd className="m-0 min-w-0 break-words font-medium text-foreground">{field.value}</dd>
        </Fragment>)}
      </dl>
    </section>)}
    {!groups.length && <p className="text-sm text-muted-foreground">Nothing was recorded on this submission.</p>}
    <section className="min-w-0 border-t border-border pt-3">
      <h3 className="mb-1.5 text-label text-muted-foreground">Submission</h3>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Submitted</dt><dd className="m-0 font-medium text-foreground">{when(detail.submittedAt)}</dd>
        <dt className="text-muted-foreground">Submitted by</dt><dd className="m-0 font-medium text-foreground">{detail.submittedBy.name}</dd>
        <dt className="text-muted-foreground">Last update</dt><dd className="m-0 font-medium text-foreground">{when(detail.updatedAt)}</dd>
        <dt className="text-muted-foreground">Outcome</dt><dd className="m-0 font-medium text-foreground">{detail.outcome ?? "Awaiting update"}</dd>
      </dl>
    </section>
  </div>;
}

function Timeline({ detail }: { detail: PartnerLeadDetail }) {
  if (!detail.timeline.length) return <p className="text-sm text-muted-foreground">No timeline events yet.</p>;
  return <ol className="m-0 flex list-none flex-col gap-3 p-0">
    {detail.timeline.map((event, index) => <li key={`${event.at}-${event.type}-${index}`} className="flex min-w-0 gap-2.5">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--primary)]" aria-hidden="true" />
      <div className="min-w-0">
        <p className="m-0 text-sm font-medium text-foreground">{event.label}</p>
        {event.detail && <p className="m-0 text-sm text-muted-foreground">{event.detail}</p>}
        <time className="text-xs text-muted-foreground">{when(event.at)}</time>
      </div>
    </li>)}
  </ol>;
}

/**
 * A lead's record, on its own page.
 *
 * It was a panel beside the board (round 1), which took 30% of the row and squeezed the board from
 * five columns to four as it opened — the owner did not like it (30 Oct). A page squeezes nothing,
 * has a back button and a URL a partner can send to their agent, and on a phone it is simply the
 * next screen rather than an overlay on a board that is already cramped.
 */
export function PartnerLeadRecord({ detail, backHref }: { detail: PartnerLeadDetail; backHref: string }) {
  const [tab, setTab] = useState<"submission" | "timeline">("submission");
  return (
    <div className="m-stagger flex min-w-0 flex-col gap-4">
      <PageHeader
        title={detail.customer}
        description={`${productLineLabel(detail.product)} — submitted by ${detail.submittedBy.name}`}
        visible
        infoDescription
        breadcrumbs={[{ label: "Pipeline", href: backHref }, { label: detail.customer }]}
        meta={<div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusChip tone={stageTone(detail)}>{stageLabel(detail)}</StatusChip>
          <span className="text-sm text-muted-foreground">{productLineLabel(detail.product)}</span>
        </div>}
        actions={<>
          <Button asChild variant="outline"><Link href={backHref}><ArrowLeft aria-hidden="true" />Back to pipeline</Link></Button>
          <Button asChild><Link href="/partner/messages"><MessageSquare aria-hidden="true" />Message your agent</Link></Button>
        </>}
      />

      <Card className="p-4">
        <Progress detail={detail} />
      </Card>

      <Card className="flex min-w-0 flex-col gap-4 p-4">
        <Segmented
          label="Lead detail"
          options={[{ key: "submission", label: "Submission" }, { key: "timeline", label: "Timeline" }]}
          value={tab}
          onChange={setTab}
        />
        {tab === "submission" ? <Submission detail={detail} /> : <Timeline detail={detail} />}
      </Card>
    </div>
  );
}
