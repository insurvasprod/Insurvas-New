"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { fileDay } from "@/lib/ingestion/constants";
import { LETTER_NEXT, LETTER_STATUS_WORD, disputeRecord, orderLetters, payIssueLetterHref, payIssueMoney as money } from "@/lib/commissions/payIssueGroups";

export type LetterRow = { id: string; carrierId: string; carrierName: string; createdAt: string; items: number; totalCents: number; status: string; sentVia: string | null; sentAt: string | null; outcomeCents: number | null; resolvedAt: string | null };

// One chip per row (owner 2026-11-11): waiting is warning, done is good, a rejection is wrong.
const TONE: Record<string, StatusTone> = { draft: "warning", sent: "warning", acknowledged: "warning", accepted: "good", partial: "warning", rejected: "danger" };
const VIA: Record<string, string> = { email: "email", portal: "the carrier's portal", post: "post" };
/** The short next step in a row; the full sentence (LETTER_NEXT) is its title. */
const NEXT: Record<string, string> = { draft: "Send letter", sent: "Record answer", acknowledged: "Record answer" };

/**
 * Pay issues › Letters out and Settled (round 7, 2·4). Letters out holds only the letters waiting on you (saved, not
 * sent) or the carrier (sent, acknowledged); Settled holds the answered ones, with each carrier's record on the right.
 * A row opens the letter's page; nothing is decided in a row.
 */
export function LettersList({ letters, tab, settled, initialCarrier = "" }: { letters: LetterRow[]; tab: "out" | "settled"; settled: LetterRow[]; initialCarrier?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<"" | "draft" | "sent">("");
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => orderLetters(letters).filter((l) => (!initialCarrier || l.carrierId === initialCarrier) && (!needle || l.carrierName.toLowerCase().includes(needle))
    && (!stage || (stage === "draft" ? l.status === "draft" : l.status === "sent" || l.status === "acknowledged"))), [letters, needle, stage, initialCarrier]);
  const notSent = letters.filter((l) => l.status === "draft").length;
  const waiting = letters.filter((l) => l.status === "sent" || l.status === "acknowledged").length;
  const record = useMemo(() => disputeRecord(settled), [settled]);
  const recordLine = tab === "settled" && record.length > 0 && (
    <span className="text-sm text-muted-foreground">
      {record.slice(0, 3).map((r, index) => (
        <span key={r.carrierId}>{index > 0 && " · "}<b className="font-semibold text-foreground">{r.name}</b> {r.won} of {r.settled}, credited {money(r.creditedCents)} of {money(r.claimedCents)}</span>
      ))}
      {record.length > 3 && ` · ${record.length - 3} more`}
    </span>
  );

  return (
    <PagedTableCard
      toolbar={
        <DataToolbar actions={<>{recordLine}<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} /></>}>
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Carrier" />
          {tab === "out" && (
            <span role="radiogroup" aria-label="Where it stands" className="inline-flex flex-wrap gap-2">
              <ToggleChip role="radio" selected={stage === "draft"} count={notSent} onClick={() => setStage(stage === "draft" ? "" : "draft")}>Not sent yet</ToggleChip>
              <ToggleChip role="radio" selected={stage === "sent"} count={waiting} onClick={() => setStage(stage === "sent" ? "" : "sent")}>Sent, no answer</ToggleChip>
            </span>
          )}
        </DataToolbar>
      }
      total={visible.length}
      noun={visible.length === 1 ? "letter" : "letters"}
      footer={visible.length ? <span className="text-sm text-muted-foreground">{tab === "out" ? "Settled letters (accepted, partly credited, rejected) are on Settled, with each carrier's record." : `${visible.length.toLocaleString("en-US")} ${visible.length === 1 ? "letter" : "letters"}, by carrier`}</span> : undefined}
    >
      {letters.length === 0 ? (
        tab === "out"
          ? <EmptyState title="No letters out" hint="Open a group on Open and draft a letter for it. You send it; record here what happened." action={<Link href="/app/discrepancies" className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">Open pay issues ›</Link>} />
          : <EmptyState title="Nothing settled yet" hint="A letter lands here once you record what the carrier did: paid in full, partly credited or rejected." />
      ) : visible.length === 0 ? <NoMatches noun="letters" onClear={() => { setQuery(""); setStage(""); }} /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th className="min-w-[200px]">Carrier</th>
              <th>Drafted</th>
              <th className="text-right">Items</th>
              <th className="text-right">Claimed</th>
              <th>{tab === "out" ? "Where it stands" : "Outcome"}</th>
              {tab === "out" ? <th>Next step</th> : <th className="text-right">Credited</th>}
            </tr>
          </thead>
          <PagedBody>
            {visible.map((letter) => {
              const href = payIssueLetterHref(letter.id);
              return (
                <tr key={letter.id} className="cursor-pointer" onClick={() => router.push(href)}>
                  <td className="whitespace-nowrap font-medium text-foreground"><Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{letter.carrierName}</Link></td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(letter.createdAt.slice(0, 10))}</td>
                  <td className="text-right tabular-nums">{letter.items.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(letter.totalCents)}</td>
                  <td>
                    <StatusChip tone={TONE[letter.status] ?? "neutral"} title={letter.sentVia ? `Sent by ${VIA[letter.sentVia] ?? letter.sentVia}${letter.sentAt ? ` on ${fileDay(letter.sentAt.slice(0, 10))}` : ""}` : undefined}>{LETTER_STATUS_WORD[letter.status] ?? letter.status}</StatusChip>
                  </td>
                  {tab === "out"
                    ? <td className="whitespace-nowrap" title={LETTER_NEXT[letter.status]}>{NEXT[letter.status] ?? "Open"} ›</td>
                    : <td className="whitespace-nowrap text-right tabular-nums">{letter.outcomeCents !== null ? money(letter.outcomeCents) : <span className="text-muted-foreground">—</span>}</td>}
                </tr>
              );
            })}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}
