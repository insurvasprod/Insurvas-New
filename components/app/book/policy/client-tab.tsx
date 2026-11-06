import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { fileDay } from "@/lib/ingestion/constants";
import { changeClientHref, LINK_TARGET_WORDS, linkMethodWord } from "@/lib/ingestion/policyPage";
import type { PolicyLink } from "@/lib/ingestion/policyPageStore";

import { UnlinkClient } from "./policy-islands";

/**
 * Policy › Client (canvas board BobE1): who the policy is linked to, how and since when, the sale, both the
 * submitted and the issued number, and every link it has had. Change client opens its own page; Unlink asks
 * first. Owner and bookkeeper change it (as Policy matching); a producer reads.
 */
export function PolicyClientTab({ link, carrierId, policyNumber, clientName, canEdit, editBlocked, pendingMessage }: {
  link: PolicyLink;
  carrierId: string;
  policyNumber: string;
  clientName: string | null;
  canEdit: boolean;
  /** Why the buttons are off for a person who could otherwise change the link (read-only account). */
  editBlocked: string | null;
  pendingMessage: string;
}) {
  if (!link.available) return <EmptyState title="Client links aren't available yet" hint={pendingMessage} />;
  const current = link.current;
  const sale = link.sale;
  // Board 22: the link this one replaced (its own row in Link history; the How tile says one was replaced).
  const before = current ? link.history.find((entry) => !entry.current) ?? null : null;
  const beforeText = before ? [before.clientName ?? (before.type === "provisional" ? "A client made from the carrier's file" : LINK_TARGET_WORDS[before.type] ?? "A sale"), linkMethodWord(before.method).toLowerCase(), `superseded ${fileDay(current?.at ?? null)}`].join(" · ") : null;
  const actions = canEdit ? (
    <div className="flex flex-wrap items-center gap-2">
      {current && <UnlinkClient matchId={current.id} clientName={current.clientName ?? clientName} disabledReason={editBlocked} />}
      {editBlocked ? (
        <Button type="button" disabled title={editBlocked}><ArrowLeftRight aria-hidden="true" />Change client</Button>
      ) : (
        <Button asChild><Link href={changeClientHref(carrierId, policyNumber)}><ArrowLeftRight aria-hidden="true" />{current ? "Change client" : "Link a client"}</Link></Button>
      )}
    </div>
  ) : undefined;

  // Round 6 (board 3): the link as the mockups' strip; why it was made behind How's (i); the link it replaced is the
  // second row of Link history (and the How tile's footnote); the buttons on Link history's head.
  const sold = sale ? [fileDay(sale.date), sale.agentName, sale.status ? sale.status.replaceAll("_", " ") : null].filter((part) => part && part !== "—").join(" · ") : "no sale on record";
  return (
    <>
      <StatStrip label="This policy's client">
        <StatTile label="Linked to" valueSize="text" value={current ? current.clientName ?? clientName ?? "No client yet" : "No client yet"} valueTone={current ? undefined : "warning"} footnote={current ? (current.dob ? `born ${fileDay(current.dob)}` : current.type === "provisional" ? "made from the carrier's file" : "date of birth not known") : canEdit ? "link one, or decide it in Needs you" : "the owner or a bookkeeper links it"} />
        <StatTile label="How" labelTitle={[current?.reason ? `Why: ${current.reason}` : null, beforeText ? `Before: ${beforeText}` : null].filter(Boolean).join("\n") || undefined} valueSize="text" value={current ? linkMethodWord(current.method) : "—"} footnote={current ? [current.type && LINK_TARGET_WORDS[current.type] ? `to ${LINK_TARGET_WORDS[current.type]}` : null, fileDay(current.at), beforeText ? "replaced an earlier link" : null].filter(Boolean).join(" · ") : "not linked"} />
        <StatTile label="Sale" valueSize="text" value={sale ? (sale.kind === "deal_flow" ? "Daily deal flow" : "Application") : "None"} footnote={sold} />
        <StatTile label="Policy number" valueSize="text" value={<span className="font-mono">{policyNumber}</span>} footnote={link.submittedNumber ? (link.submittedNumber === policyNumber ? "submitted as the same" : `submitted as ${link.submittedNumber}`) : "submitted number not recorded"} />
      </StatStrip>

      <PagedTableCard total={link.history.length} noun="links" title="Link history" action={actions}>
        {link.history.length === 0 ? (
          <EmptyState title="No links yet" hint="Each time this policy is linked to a client, by Insurvas or a person, it shows here." />
        ) : (
          <table className="portal-lead-table w-full min-w-[600px] text-left text-sm">
            <thead><tr><th className="w-[120px]">When</th><th>What</th><th>Why</th><th className="w-[160px]">By</th></tr></thead>
            <PagedBody>
              {link.history.map((entry) => (
                <tr key={entry.id}>
                  <td className="tabular-nums text-muted-foreground">{fileDay(entry.at)}</td>
                  <td>{entry.clientName ? `Linked to ${entry.clientName}` : entry.type === "provisional" ? "Linked to a client made from the carrier's file" : `Linked to ${LINK_TARGET_WORDS[entry.type] ?? "a sale"}`} <span className="text-muted-foreground">· {linkMethodWord(entry.method).toLowerCase()}{entry.current ? " · now" : ""}</span></td>
                  <td className="max-w-[320px] truncate text-muted-foreground" title={entry.reason ?? undefined}>{entry.reason ?? "—"}</td>
                  <td className="text-muted-foreground">{entry.by}</td>
                </tr>
              ))}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    </>
  );
}
