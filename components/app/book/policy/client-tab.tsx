import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { changeClientHref, LINK_TARGET_WORDS, linkMethodWord } from "@/lib/ingestion/policyPage";
import type { PolicyLink } from "@/lib/ingestion/policyPageStore";

import { FactGrid } from "./policy-head";
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
  const saleText = sale
    ? [sale.kind === "deal_flow" ? "Daily deal flow" : "Application", fileDay(sale.date), sale.agentName, sale.status ? sale.status.replaceAll("_", " ") : null].filter((part) => part && part !== "—").join(" · ")
    : "No sale on record";
  const issuedText = link.submittedNumber && link.submittedNumber !== policyNumber ? policyNumber : `${policyNumber}${link.submittedNumber ? " (same)" : ""}`;
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

  return (
    <>
      <TableCard title="Linked to" action={actions}>
        {current ? (
          <FactGrid items={[
            ["Client", `${current.clientName ?? clientName ?? "No client yet"}${current.dob ? ` · born ${fileDay(current.dob)}` : ""}`],
            ["How", `${linkMethodWord(current.method)}${current.type && LINK_TARGET_WORDS[current.type] ? `, to ${LINK_TARGET_WORDS[current.type]}` : ""}`],
            ["Since", fileDay(current.at)],
            ["Sale", saleText],
            ["Submitted number", link.submittedNumber ?? "Not recorded"],
            ["Issued number", issuedText],
          ]} />
        ) : (
          <p className="m-0 px-4 pb-4 text-sm text-muted-foreground">No client is linked to this policy yet.{canEdit ? " Link one, or decide it in Needs you." : " The owner or a bookkeeper links it."}</p>
        )}
        {current?.reason && <p className="m-0 border-t border-border px-4 py-3 text-sm text-muted-foreground">Why: <span className="text-foreground">{current.reason}</span></p>}
      </TableCard>

      <PagedTableCard total={link.history.length} noun="links" title="Link history">
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
