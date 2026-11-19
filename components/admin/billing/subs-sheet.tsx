"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AddonsPanel } from "@/components/admin/addons-panel";
import { SubscriptionCards } from "@/components/admin/tenant-record/subscription-cards";
import { TenantInvoicesCard } from "@/components/admin/tenant-record/tenant-invoices-card";
import { pillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FactTable } from "@/components/ui/fact-table";
import { NoteField } from "@/components/ui/note-field";
import { StatusChip } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import { LIST_STATUS, fullDate, type SubscriptionListRow } from "@/lib/subscriptionsList/model";
import type { SubscriptionSheetData } from "@/lib/subscriptionsList/sheet";
import { cn } from "@/lib/utils";

const CYCLE_UNIT = { monthly: "month", quarterly: "quarter", yearly: "year" } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 15, 2026 · 09:12 UTC": the same on the server and in the browser. */
const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};

/**
 * The subscription's sheet on Admin › Subscriptions (billing-r2 screen 2): a wide right panel over the list.
 * The panel draws at once from the list's row; its body (`children`) is the server-rendered SubsSheetBody,
 * which arrives with the reads the actions need.
 */
export function SubsSheetFrame({ row, loading, onClose, children }: { row: SubscriptionListRow | null; loading: boolean; onClose: () => void; children: ReactNode }) {
  const state = row ? LIST_STATUS[row.status] : null;
  return (
    <DetailPanel
      mode="overlay"
      className="lg:w-[min(760px,calc(100vw-80px))]"
      title={row?.tenantName ?? "Subscription"}
      subtitle={row ? `${row.planName}${row.planVersion !== null ? ` v${row.planVersion}` : ""} · ${BILLING_CYCLE_LABELS[row.cycle].toLowerCase()} · since ${fullDate(row.startedAt)}` : undefined}
      status={state ? <StatusChip tone={pillTone(state.tone)} dot>{state.label}</StatusChip> : undefined}
      onClose={onClose}
      closeLabel="Close the subscription"
      footer={
        <>
          {row && (
            <Link href={`/admin/tenants/${row.tenantId}?tab=subscription`} className="rounded-sm text-sm font-semibold text-[var(--accent-ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
              Open customer record ›
            </Link>
          )}
          <span className="flex-1" />
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </>
      }
      bodyClassName="flex flex-col"
    >
      {loading || !children ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-3 p-4">
          <span className="sr-only">Loading the subscription</span>
          {Array.from({ length: 6 }, (_, i) => <span key={i} aria-hidden="true" className="m-skel h-6 w-full rounded-md" />)}
        </div>
      ) : (
        children
      )}
    </DetailPanel>
  );
}

type SheetTab = "subscription" | "invoices" | "discount" | "history" | "notes";

/** The sheet's body: Subscription · Invoices · Discount · History · Notes, the actions the tenant record's own. */
export function SubsSheetBody({ data, row }: { data: SubscriptionSheetData | null; row: SubscriptionListRow | null }) {
  const [tab, setTab] = useState<SheetTab>("subscription");
  if (!data) {
    return <p className="m-0 p-4 text-sm text-muted-foreground">This subscription could not be found. It may have been removed; close the sheet and refresh the list.</p>;
  }
  const tabs = [
    { key: "subscription" as const, label: "Subscription" },
    { key: "invoices" as const, label: "Invoices", count: data.invoices?.length ?? null },
    { key: "discount" as const, label: "Discount" },
    { key: "history" as const, label: "History", count: data.history?.length ?? null },
    { key: "notes" as const, label: "Notes", count: data.notes?.length ?? null },
  ].filter((item) => item.key !== "invoices" || data.invoices !== null);

  // The record's own sections, inside its sheet (as a campaign's sheet has): not the page's sub-page bar.
  const sections = <UnderlineTabs label="Subscription sections" tabs={tabs} value={tab} onChange={setTab} idPrefix="subs-sheet" className="shrink-0 px-4" />;
  return (
    <>
      {sections}
      <div role="tabpanel" aria-labelledby={`subs-sheet-${tab}`} className="flex min-w-0 flex-col gap-4 p-4">
        {tab === "subscription" && <SubscriptionPart data={data} row={row} />}
        {tab === "invoices" && data.invoices && <TenantInvoicesCard tenant={data.tenant} invoices={data.invoices} />}
        {tab === "discount" && <DiscountPart data={data} />}
        {tab === "history" && <HistoryPart data={data} />}
        {tab === "notes" && <NotesPart data={data} />}
      </div>
    </>
  );
}

/** Everything the old expanded row showed, then the tenant record's own cards and their actions. */
function SubscriptionPart({ data, row }: { data: SubscriptionSheetData; row: SubscriptionListRow | null }) {
  const state = row ? LIST_STATUS[row.status] : null;
  const facts: Array<[string, ReactNode]> = row
    ? [
        ["Started", <span key="s" title={row.startedFull}>{row.startedFull}</span>],
        ["Current period", <span key="p" title={row.periodFull}>{row.periodFull}</span>],
        ["Monthly equivalent", row.monthlyCents === null ? "Could not be read" : row.countsTowardMrr ? `${formatCentsAsCurrency(row.monthlyCents)} / month, counted in MRR` : `${formatCentsAsCurrency(row.monthlyCents)} / month, not counted (${state?.label.toLowerCase()})`],
        ["Billed", `Every ${CYCLE_UNIT[row.cycle]}${row.cycleCents !== null ? ` · ${formatCentsAsCurrency(row.cycleCents)} at list price` : ""}`],
        ["Trial ends", row.trialEndsFull],
        ["Queued plan", row.pendingPlanLabel ? `${row.pendingPlanLabel}, at renewal` : null],
        ["Queued change", row.queuedText === "—" ? null : row.queuedText],
        ["Access ended", row.cancelledFull],
        ["Cancellation reason", row.status === "cancelling" || row.status === "cancelled" || row.cancelReason ? row.cancelReason ?? "None recorded" : null],
      ]
    : [];
  const elsewhere = data.liveSubscriptionId !== null && data.liveSubscriptionId !== data.subscriptionId;
  return (
    <>
      {facts.length > 0 && <FactTable rows={facts} labelWidth={160} />}
      {elsewhere && (
        <p className="m-0 text-xs text-muted-foreground">This subscription has ended. The changes below apply to the customer&apos;s current subscription.</p>
      )}
      {data.cards && <SubscriptionCards {...data.cards} />}
      {data.addons && <AddonsPanel {...data.addons} />}
    </>
  );
}

function DiscountPart({ data }: { data: SubscriptionSheetData }) {
  if (!data.cards?.coupons) {
    return <p className="m-0 text-sm text-muted-foreground">{data.coupon ? `${data.coupon.code} · ${data.coupon.summary}` : "Coupons are managed by super admins and billing admins."}</p>;
  }
  return (
    <FactTable
      rows={[
        ["Coupon", data.coupon ? data.coupon.code : "None applied"],
        ["Discount", data.coupon?.summary ?? null],
        ["Change", "Apply or remove a coupon from the Subscription tab's actions."],
      ]}
      labelWidth={120}
    />
  );
}

function HistoryPart({ data }: { data: SubscriptionSheetData }) {
  if (data.history === null) return <p className="m-0 text-sm text-muted-foreground">The history could not be read just now. Close and reopen the sheet to try again.</p>;
  if (data.history.length === 0) return <p className="m-0 text-sm text-muted-foreground">Nothing has been recorded for this customer&apos;s billing yet.</p>;
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {data.history.map((item) => (
        <li key={item.id} className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0">
          <span className="text-sm text-foreground">{item.label}{item.by ? <span className="text-muted-foreground"> · by {item.by}</span> : null}</span>
          {item.reason && <span className="text-xs text-muted-foreground">{item.reason}</span>}
          <time dateTime={item.at} className="text-xs text-muted-foreground">{stamp(item.at)}</time>
        </li>
      ))}
    </ol>
  );
}

function NotesPart({ data }: { data: SubscriptionSheetData }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  if (data.notesError === "missing") {
    return <p className="m-0 text-sm text-muted-foreground">Notes need a database update before they can be kept here.</p>;
  }
  if (data.notesError === "failed" || data.notes === null) {
    return <p className="m-0 text-sm text-muted-foreground">The notes could not be read just now. Close and reopen the sheet to try again.</p>;
  }

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/subscriptions/${data.subscriptionId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      notify.block(body?.error ?? "The note could not be saved");
      return;
    }
    notify.done("Note saved");
    setDraft("");
    router.refresh();
  }

  return (
    <>
      {data.canNote && (
        <div className="flex flex-col gap-2">
          <NoteField value={draft} onChange={setDraft} placeholder="What should the next person know about this customer's billing?" aria-label="New note" rows={3} maxLength={2000} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Notes are kept for good and seen only by staff.</span>
            <Button type="button" size="sm" className="ml-auto" disabled={busy || draft.trim() === ""} onClick={() => void save()}>{busy ? "Saving…" : "Add note"}</Button>
          </div>
        </div>
      )}
      {data.notes.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {data.notes.map((note) => (
            <li key={note.id} className={cn("flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0")}>
              <span className="whitespace-pre-wrap text-sm text-foreground">{note.body}</span>
              <span className="text-xs text-muted-foreground">{note.by ?? "An admin"} · <time dateTime={note.at}>{stamp(note.at)}</time></span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
