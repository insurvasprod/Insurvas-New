import { redirect } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";

/**
 * AG-1.4 · the Attribution queue is decided in Book of business › Needs you (owner 2026-11-02): every open row
 * is a "Who gets the credit" item there, decided under its row with the same producer choice and reason, and
 * the resolved ones are under Closed. The old address keeps working: Needs you opens on the Credit group.
 */
export default async function AttributionPage() {
  // Needs you applies the gate itself; this only keeps the session check every shell page makes.
  await guardPage("producer_payouts");
  redirect("/app/needs-you?view=agency&group=credit");
}
