"use client";

import { useEffect, useState } from "react";
import { FileText, Languages, MessageSquare, Phone, UserRound } from "lucide-react";

import { stageLabel, stageTone, when } from "@/components/partner/lead-format";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { SettingsLayout } from "@/components/ui/settings-layout";
import { productLineLabel } from "@/lib/format/productLine";
import type { PartnerLeadDetail } from "@/lib/partnerLeads/types";
import type { SnapshotGroup } from "@/lib/partnerLeads/view";

const groupId = (key: string) => `partner-lead-group-${key}`;

function InformationGroup({ group }: { group: SnapshotGroup }) {
  return (
    <section id={groupId(group.key)} aria-labelledby={`${groupId(group.key)}-heading`} className="min-w-0 scroll-mt-24 px-5 py-4">
      <h3 id={`${groupId(group.key)}-heading`} className="m-0 text-sm font-semibold text-foreground">{group.label}</h3>
      <dl className="m-0 mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {group.fields.map((field) => (
          <div key={field.key} className="min-w-0">
            <dt className="text-xs font-medium leading-4 text-muted-foreground">{field.label}</dt>
            <dd className="m-0 mt-1 break-words text-sm font-medium leading-5 text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The application as submitted, plus the record's own facts, as the groups the side navigation lists. */
function applicationGroups(detail: PartnerLeadDetail): SnapshotGroup[] {
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
  return [...detail.groups, recordGroup];
}

function Submission({ detail, groups }: { detail: PartnerLeadDetail; groups: SnapshotGroup[] }) {
  return (
    <div id="partner-lead-overview" role="tabpanel" aria-labelledby="partner-lead-tab-overview" className="min-w-0 overflow-hidden rounded-lg border border-border bg-card outline-none">
      <div className="flex items-center gap-1.5 border-b border-border px-5 py-3">
        <h2 className="m-0 text-base font-semibold text-foreground">Application</h2>
        <InfoTip label="About this application">The form as it was submitted. It is view only; your agency works the lead from here.</InfoTip>
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
  const groups = applicationGroups(detail);
  // One selection for the whole side navigation: a tab ("overview", "call-updates", "notes") or, while the
  // overview is open, the application group being read.
  const [active, setActive] = useState<string>(groups[0]?.key ?? "overview");
  const tab: "overview" | "call-updates" | "notes" = active === "call-updates" || active === "notes" ? active : "overview";
  const groupKeys = groups.map((group) => group.key).join("|");

  // While the overview is open the side navigation follows the reader: the group nearest the top is the lit one.
  useEffect(() => {
    if (tab !== "overview") return;
    const targets = groupKeys.split("|").map((key) => document.getElementById(groupId(key))).filter((node): node is HTMLElement => Boolean(node));
    if (!targets.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id.replace("partner-lead-group-", ""));
    }, { rootMargin: "-20% 0px -65% 0px" });
    targets.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [tab, groupKeys]);

  function choose(key: string) {
    setActive(key);
    if (key !== "call-updates" && key !== "notes") {
      // The overview may have to mount first when the reader comes from another tab.
      window.setTimeout(() => document.getElementById(groupId(key))?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

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
      />
      {/* The lead's own pages, then the application's sections: one side navigation, as in Settings. */}
      <SettingsLayout
        active={active}
        onSelect={choose}
        collapsible
        groups={[
          { key: "application", label: "Application", sections: groups.map((group) => group.key) },
          { key: "activity", label: "Activity", sections: ["call-updates", "notes"] },
        ]}
        sections={[
          ...groups.map((group) => ({ key: group.key, label: group.label, icon: <UserRound className="size-4" aria-hidden="true" /> })),
          { key: "call-updates", label: "Call updates", icon: <Phone className="size-4" aria-hidden="true" /> },
          { key: "notes", label: "Notes", icon: <FileText className="size-4" aria-hidden="true" /> },
        ]}
      >
        {tab === "overview" ? <Submission detail={detail} groups={groups} /> : tab === "call-updates" ? <CallUpdates detail={detail} /> : <SharedNotes detail={detail} />}
      </SettingsLayout>
    </div>
  );
}
