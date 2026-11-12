/**
 * Commissions › Who gets the credit (round 7, docs/la4/mockups-r7/commissions.html 3·A and 3·1): how a credit row
 * reads and where it leads. Pure: the server pages and the client list share it.
 */
import type { CreditRow, CreditWhy } from "@/lib/agency/moneyStores";

export const CREDIT_HREF = "/app/attribution";
export type CreditView = "decide" | "codes" | "decided";

export const WHY_CHIP: Record<CreditWhy, string> = { two: "Two producers named", code: "Code isn't anyone yet", none: "No writing number" };

/** The row's Why, in a sentence. */
export function whyText(row: Pick<CreditRow, "why" | "agentIdentifier">): string {
  if (row.why === "two") return "The writing number and the application name different producers";
  if (row.why === "code") return `Agent code ${row.agentIdentifier} isn't anyone yet`;
  return "No writing number on the row";
}

export const itemHref = (id: string) => `${CREDIT_HREF}/${id}`;

/** The item's name: its client, else its policy. */
export const nameOf = (row: Pick<CreditRow, "clientName" | "policyNumber">) => row.clientName ?? row.policyNumber ?? "A statement row";
/** The item page's title: "{client} · {policy}". */
export const titleOf = (row: Pick<CreditRow, "clientName" | "policyNumber">) => [row.clientName, row.policyNumber].filter(Boolean).join(" · ") || "A statement row";

/** Whole days since a timestamp, by the calendar day. */
export function ageDays(since: string, today = new Date().toISOString().slice(0, 10)): number {
  const from = Date.UTC(Number(since.slice(0, 4)), Number(since.slice(5, 7)) - 1, Number(since.slice(8, 10)));
  const to = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Oldest first; amber after 30 days, red after 90. */
export const ageTone = (days: number): "danger" | "warning" | undefined => (days > 90 ? "danger" : days > 30 ? "warning" : undefined);

export const policyPageHref = (carrierId: string, policyNumber: string) => `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}?tab=commissions`;
export const statementRowHref = (fileId: string, rowNumber: number) => `/app/carrier-files/file/${fileId}/row/${rowNumber}`;
