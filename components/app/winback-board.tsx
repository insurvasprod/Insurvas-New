"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { LinkRow } from "@/components/app/book/setup/link-row";
import {
  chanceWhy, clientName, coverText, money, nextStep, paidText, phoneText, policyHref, whenToCall, winbackClaimHref, winbackClientHref, winbackList,
  type WinbackView,
} from "@/components/app/retention/winback-stages";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { BAND_LABELS, CATEGORY_LABELS, SOURCE_LABELS } from "@/lib/retention/winback";
import type { Winback, WinbackRow } from "@/lib/retention/winbackStore";

/** When to call, as the row's one chip: on the list is done, stuck is wrong, the rest waits or rests. */
const WHEN_TONE = { good: "good", danger: "danger", plain: "warning", muted: "neutral" } as const satisfies Record<string, StatusTone>;

/** An empty tab, in the words of board 3·2. */
const EMPTY: Record<Exclude<WinbackView, "claims">, { title: string; hint: string }> = {
  open: { title: "Nobody to win back yet", hint: "Every former client is on Never call or Possible claims." },
  released: { title: "Nobody to call now", hint: "A client goes on the Win-back list when the cooling-off for why they left ends." },
  blocked: { title: "Nobody is stuck", hint: "A client who couldn't go on the list (no phone, no state, on a do-not-call list) shows here with why." },
  soon: { title: "Nobody comes off cooling-off this month", hint: "A client shows here 30 days before they may be called." },
  resting: { title: "Nobody is cooling off", hint: "A client waits here until the cooling-off for why they left ends." },
  never: { title: "Nobody on Never call", hint: "A client who asked not to be contacted, or who died, shows here and is never called." },
};

/**
 * Retention › Win-back, the list (LA-5.7; round 7, owner pick 3·A, 2026-11-10): who lapsed past reinstatement,
 * why (and how we know), and when they may be called again; at that date they go to the Win-back lead list, which
 * is scrubbed before anyone dials. Where they stand is the tab on the title line (the page draws it, `view`); the
 * two old notices are its counts, and the table fills the window. A row opens the former client's page (a claim
 * opens its own, where Mark handled lives): no buttons in a row. The last column says the next step in words.
 */
export function WinbackBoard({ data, view }: { data: Winback; view: WinbackView }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const needle = search.trim().toLowerCase();
  const clear = () => { setSearch(""); setPage(1); };
  const listed = useMemo(() => winbackList(data.rows, view, data.today), [data.rows, view, data.today]);
  const visible = useMemo(() => listed.filter((r) => !needle || [r.clientName, r.policyNumber, r.carrierName, r.phone].some((v) => v?.toLowerCase().includes(needle))), [listed, needle]);
  const claims = useMemo(() => (view === "claims" ? data.claims.filter((c) => !needle || [c.clientName, c.policyNumber, c.carrierName].some((v) => v?.toLowerCase().includes(needle))) : []), [data.claims, view, needle]);
  const pageSize = useFittingPageSize(260, 57);
  const shown = paginate(visible, page, pageSize);
  const shownClaims = paginate(claims, page, pageSize);
  const total = view === "claims" ? claims.length : visible.length;

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<>
          {needle && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
        </DataToolbar>
      }
      footer={total ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-foreground">{view === "claims" ? "A policy that lapsed after a reported death: help the family claim, never a win-back call" : "Stuck and callable first · a client is called again only after the cooling-off for why they left"}</span>
          <Pager page={view === "claims" ? shownClaims.current : shown.current} pageSize={pageSize} total={total} noun={view === "claims" ? "claims" : "clients"} onPage={setPage} />
        </div>
      ) : undefined}
    >
      {view === "claims" ? (
        claims.length === 0 ? (
          needle ? <NoMatches noun="claims" onClear={clear} /> : <EmptyState title="No possible claims" hint="A policy that lapsed after a reported death shows here: help the family claim, or mark it handled." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Client</th><th>Policy</th><th>Reported</th><th>Status</th><th>Next step</th></tr></thead>
            <tbody className="m-seq">
              {shownClaims.rows.map((c) => {
                const href = winbackClaimHref(c.id);
                return (
                  <LinkRow key={c.id} href={href} className="m-row">
                    <td className="whitespace-nowrap font-medium text-foreground"><Link href={href} className="hover:underline">{c.clientName ? clientName({ clientName: c.clientName, policyNumber: c.policyNumber }) : "No client linked"}</Link></td>
                    <td className="whitespace-nowrap"><Link href={policyHref(c.carrierId, c.policyNumber)} className="hover:underline">{c.carrierName} {c.policyNumber}</Link></td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(c.createdAt.slice(0, 10))}</td>
                    {/* What the carrier reported is the chip's tooltip and the claim page's own line. */}
                    <td><StatusChip tone="danger" title={c.reason}>Possible claim</StatusChip></td>
                    <td className="whitespace-nowrap" title="Help the family claim">Help claim ›</td>
                  </LinkRow>
                );
              })}
            </tbody>
          </table>
        )
      ) : data.rows.length === 0 ? (
        <EmptyState title="No lapsed clients yet" hint="A client shows here once their policy is past the carrier's reinstatement window." />
      ) : visible.length === 0 ? (
        needle ? <NoMatches noun="clients" onClear={clear} /> : <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>Client</th>
              <th>Policy</th>
              <th>Why it ended</th>
              <th>When to call</th>
              <th>Chance</th>
              <th>Next step</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {shown.rows.map((r) => <Row key={r.id} r={r} view={view} today={data.today} />)}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

function Row({ r, view, today }: { r: WinbackRow; view: WinbackView; today: string }) {
  const href = winbackClientHref(r.id, view);
  const when = whenToCall(r, today);
  const next = nextStep(r, today);
  const source = SOURCE_LABELS[r.source];
  // One line per row (owner 2026-11-11): phone, age and state, the premium, how we know and the chance's reason are
  // tooltips here and lines on the client's page. A call goes through the Win-back list's gates, never a tel: link.
  const who = [r.phone ? phoneText(r.phone) : "No phone on file", r.age !== null ? String(r.age) : null, r.state].filter(Boolean).join(" · ");
  const had = [`${money(r.premiumCents)}/mo`, coverText(r.faceCents), paidText(r.monthsPaid)].filter(Boolean).join(" · ");
  const why = [`${source.charAt(0).toUpperCase() + source.slice(1)} · lapsed ${fileDay(r.lapsedOn)}`, r.detail && r.source !== "none" ? r.detail : null].filter(Boolean).join(" · ");
  return (
    <LinkRow href={href} className="m-row">
      <td className="whitespace-nowrap font-medium text-foreground"><Link href={href} className="hover:underline" title={who}>{r.clientName ? clientName(r) : "No client linked"}</Link></td>
      <td className="whitespace-nowrap"><Link href={policyHref(r.carrierId, r.policyNumber)} className="hover:underline" title={had}>{r.carrierName} {r.policyNumber}</Link></td>
      <td className="whitespace-nowrap" title={why}>{CATEGORY_LABELS[r.category]}</td>
      <td><StatusChip tone={WHEN_TONE[when.tone]} title={when.sub ?? undefined}>{when.line}</StatusChip></td>
      <td className="whitespace-nowrap" title={chanceWhy(r)}>{BAND_LABELS[r.band]}</td>
      <td className="whitespace-nowrap" title={next.why}>{next.step} ›</td>
    </LinkRow>
  );
}
