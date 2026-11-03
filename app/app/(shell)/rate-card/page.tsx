import { redirect } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";

/**
 * Rate card (LA-4.13) lives in Book of business › Setup (owner 2026-11-02: "where it belongs"; it was a
 * Commissions step and the same screen twice). The old address keeps working: Setup opens on the rate card.
 */
export default async function RateCardPage() {
  // Setup applies the gate itself; this only keeps the session check every shell page makes.
  await guardPage("statement_ingestion");
  redirect("/app/book-setup");
}
