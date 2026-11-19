import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_INVOICES } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { csvOf } from "@/lib/subscriptionsList/filters";

/**
 * GET /api/admin/billing/export?month=YYYY-MM — the billing workspace's "Export month" (billing-r2 screen 1): one
 * CSV of the month's invoices (by issue date, else creation), payments (by when they were paid) and credit notes
 * (by when they were raised), for the bookkeeper. Read-only; the same roles that may open invoices.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const month = request.nextUrl.searchParams.get("month") ?? "";
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return NextResponse.json({ error: "Give the month as YYYY-MM" }, { status: 400 });
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).toISOString();
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1)).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- credit_notes and payments are read loosely here
  const db = getSupabaseServiceClient() as any;
  const [invoices, payments, notes] = await Promise.all([
    db.from("platform_invoices").select("id, number, status, total_cents, issued_at, created_at, due_at, paid_at, reconciliation, tenants(name)").or(`and(issued_at.gte.${start},issued_at.lt.${end}),and(issued_at.is.null,created_at.gte.${start},created_at.lt.${end})`).order("number"),
    db.from("payments").select("id, invoice_id, amount_cents, method, provider, provider_charge_id, manual_reference, status, paid_at, tenants(name)").gte("paid_at", start).lt("paid_at", end).order("paid_at"),
    db.from("credit_notes").select("id, number, invoice_id, type, amount_cents, reason_code, reason_text, status, created_at, tenants(name)").gte("created_at", start).lt("created_at", end).order("number"),
  ]);
  const failed = [invoices, payments, notes].find((result) => result.error);
  if (failed) {
    console.error("[admin/billing/export] read failed:", failed.error.message);
    return NextResponse.json({ error: "The month could not be read. Try again." }, { status: 500 });
  }

  type Named = { tenants: { name: string } | null };
  const invoiceRows = (invoices.data ?? []) as (Named & { id: string; number: string; status: string; total_cents: number; issued_at: string | null; created_at: string; due_at: string | null; paid_at: string | null; reconciliation: string })[];
  const numberOf = new Map(invoiceRows.map((row) => [row.id, row.number]));
  const missing = [
    ...((payments.data ?? []) as { invoice_id: string | null }[]),
    ...((notes.data ?? []) as { invoice_id: string | null }[]),
  ].map((row) => row.invoice_id).filter((id): id is string => Boolean(id) && !numberOf.has(id as string));
  if (missing.length) {
    const extra = await db.from("platform_invoices").select("id, number").in("id", [...new Set(missing)]);
    for (const row of (extra.data ?? []) as { id: string; number: string }[]) numberOf.set(row.id, row.number);
  }
  const dollars = (cents: number) => (cents / 100).toFixed(2);
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

  const rows = [
    ...invoiceRows.map((row) => ["Invoice", row.number, row.tenants?.name ?? "", day(row.issued_at ?? row.created_at), row.status, dollars(row.total_cents), row.number, `due ${day(row.due_at)}${row.paid_at ? ` · paid ${day(row.paid_at)}` : ""}`, row.reconciliation]),
    ...((payments.data ?? []) as (Named & { invoice_id: string | null; amount_cents: number; method: string; provider: string | null; provider_charge_id: string | null; manual_reference: string | null; status: string; paid_at: string })[]).map((row) => [
      "Payment", "", row.tenants?.name ?? "", day(row.paid_at), row.status, dollars(row.amount_cents), row.invoice_id ? numberOf.get(row.invoice_id) ?? "" : "", [row.method, row.provider].filter(Boolean).join(" · "), row.provider_charge_id ?? row.manual_reference ?? "",
    ]),
    ...((notes.data ?? []) as (Named & { number: string; invoice_id: string | null; type: string; amount_cents: number; reason_code: string; reason_text: string | null; status: string; created_at: string })[]).map((row) => [
      "Credit note", row.number, row.tenants?.name ?? "", day(row.created_at), row.status, dollars(-row.amount_cents), row.invoice_id ? numberOf.get(row.invoice_id) ?? "" : "", [row.type, row.reason_code, row.reason_text].filter(Boolean).join(" · "), "",
    ]),
  ];

  const csv = csvOf(["Record", "Number", "Customer", "Date", "Status", "Amount (USD)", "Invoice", "Detail", "Reference"], rows);
  return new NextResponse(`﻿${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="insurvas-billing-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
