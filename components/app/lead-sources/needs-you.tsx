"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LeadListRow } from "@/lib/leadLists/service";

/**
 * "Needs you" (Lead sources / Vendor bills, owner pick 2026-10-26, canvas M2 · Vendors): the first
 * thing waiting on this person, as the page's one "Next step" line with its button. Since the Lists
 * step's redesign (board LinB4, 2026-10-28) the other cards are gone: every list's scrub, claim and
 * assign is the button on its own row of the table, so a card per list said the same thing twice. Read from the APIs the tabs already use, each only when this person may open it;
 * a read that fails leaves its cards out rather than showing an error twice.
 */
export type NeedsYouAccess = {
  /** Lead lists (lead_import, owner / producer / assistant). */
  lists: boolean;
  /** Money on a list: claimable leads (True CPA, owner / producer). */
  claims: boolean;
  /** Lead invoices (profit_and_loss, owner / bookkeeper). */
  invoices: boolean;
  /** Where an invoice card leads: the Invoices tab of Vendor bills. */
  invoicesHref: string;
  /** Where the scrub card leads: the Campaigns tab, which runs the scrub. Null when this person cannot open it. */
  campaignsHref: string | null;
};

type Card = { key: string; kicker: string; title: string; detail: string; action: string; href: string };

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function cardsFromLists(lists: LeadListRow[], access: NeedsYouAccess): Card[] {
  const cards: Card[] = [];
  // An active list the queue will not serve until it is scrubbed (campaigns_servable).
  const unscrubbed = lists.find((list) => list.status === "active" && list.scrubStatus !== "scrubbed" && list.leadsReceived > 0);
  if (unscrubbed) cards.push({
    key: `scrub:${unscrubbed.campaignId}`, kicker: "Scrub before dialing", title: unscrubbed.campaignName,
    detail: `${unscrubbed.vendorName} · ${plural(unscrubbed.leadsReceived, "lead")} · not scrubbed`,
    action: access.campaignsHref ? "Run the scrub" : "Open the list",
    href: access.campaignsHref ?? `/app/lead-lists/${unscrubbed.campaignId}`,
  });
  // Usable work nobody owns yet: the list page assigns it.
  const unassigned = lists.filter((list) => list.untouched > 0 && list.scrubStatus === "scrubbed" && list.status === "active").sort((a, b) => b.untouched - a.untouched)[0];
  if (unassigned) cards.push({
    key: `assign:${unassigned.campaignId}`, kicker: "Ready to assign", title: unassigned.campaignName,
    detail: `${unassigned.vendorName} · ${plural(unassigned.untouched, "lead")} never dialled`,
    action: "Assign", href: `/app/lead-lists/${unassigned.campaignId}`,
  });
  // Leads the vendor still owes back, while the return window is open.
  if (access.claims) {
    const claimable = lists.filter((list) => list.claimable > 0).sort((a, b) => b.claimable - a.claimable)[0];
    if (claimable) cards.push({
      key: `claim:${claimable.campaignId}`, kicker: "Money owed back", title: claimable.vendorName,
      detail: `${plural(claimable.claimable, "bad lead")} on ${claimable.campaignName} · window open`,
      action: "Claim it", href: `/app/lead-lists/${claimable.campaignId}`,
    });
  }
  return cards;
}

export function NeedsYou({ access, only }: { access: NeedsYouAccess; /** Which kinds this page shows. */ only?: ReadonlyArray<"lists" | "invoices"> }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const wantLists = access.lists && (!only || only.includes("lists"));
  const wantInvoices = access.invoices && (!only || only.includes("invoices"));

  useEffect(() => {
    const controller = new AbortController();
    const read = (url: string) => fetch(url, { cache: "no-store", signal: controller.signal }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
    void Promise.all([wantLists ? read("/api/app/lead-lists") : null, wantInvoices ? read("/api/app/accounting/invoices") : null]).then(([lists, invoices]) => {
      if (controller.signal.aborted) return;
      const next: Card[] = [];
      if (lists && Array.isArray(lists.lists)) next.push(...cardsFromLists(lists.lists as LeadListRow[], access));
      if (invoices && Array.isArray(invoices.invoices)) {
        const waiting = (invoices.invoices as Array<{ id: string; status: string; invoiceNumber: string; sourceName: string }>).filter((invoice) => invoice.status === "received");
        if (waiting.length) next.push({
          key: "invoices", kicker: "Invoice to approve",
          title: waiting.length === 1 ? `${waiting[0].sourceName} · ${waiting[0].invoiceNumber}` : plural(waiting.length, "invoice"),
          detail: "Check it against what arrived, then approve or dispute",
          action: waiting.length === 1 ? "Open it" : "Review", href: waiting.length === 1 ? `${access.invoicesHref}&open=${encodeURIComponent(waiting[0].id)}` : access.invoicesHref,
        });
      }
      setCards(next);
    });
    return () => controller.abort();
    // The access flags are fixed for the page; reading again on every render would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantLists, wantInvoices]);

  if (!cards || cards.length === 0) return null;
  const first = cards[0];
  // The page's one line: the first thing waiting, with its button.
  return (
    <section aria-label="Next step" className="m-glass flex flex-wrap items-center gap-4 rounded-xl border border-border px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--accent-ink)]"><ArrowRight className="size-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1 text-sm text-[var(--body)]">
        <span className="block text-xs font-semibold text-[var(--accent-ink)]">Next step</span>
        {first.kicker}: <strong className="font-semibold text-[var(--ink)]">{first.title}</strong> · {first.detail}
      </span>
      <Button asChild size="sm"><Link href={first.href}>{first.action}</Link></Button>
    </section>
  );
}
