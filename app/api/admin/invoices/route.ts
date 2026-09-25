import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_INVOICES } from "@/lib/invoices/permissions";
import { fetchInvoices } from "@/lib/invoices/queries";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/invoices/constants";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");

  // A filter that is accepted and then not applied is worse than one that is refused: the caller
  // gets every invoice back under a heading that says "overdue only". `overdue=true` worked and
  // `overdue=1` returned all 220 rows — the browser happens to send "true", so the screen was
  // right and the API was not. Accept the spellings a human would reach for, and refuse the rest
  // rather than silently reading them as false.
  const booleanParam = (name: string): boolean | "invalid" => {
    const raw = params.get(name);
    if (raw === null || raw === "") return false;
    const value = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(value)) return true;
    if (["false", "0", "no", "off"].includes(value)) return false;
    return "invalid";
  };

  const overdueOnly = booleanParam("overdue");
  const mismatchedOnly = booleanParam("mismatched");
  for (const [name, value] of [["overdue", overdueOnly], ["mismatched", mismatchedOnly]] as const) {
    if (value === "invalid") {
      return NextResponse.json({ error: `\`${name}\` must be true or false` }, { status: 400 });
    }
  }

  // Same reasoning for an unrecognised status: falling back to "all" turns a typo into a silently
  // wider result set that looks like a filtered one.
  if (status && !(INVOICE_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `Unknown status. Expected one of: ${INVOICE_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const invoices = await fetchInvoices({
      status: status ? (status as InvoiceStatus) : "all",
      tenantId: params.get("tenant") ?? undefined,
      overdueOnly: overdueOnly === true,
      mismatchedOnly: mismatchedOnly === true,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });

    return NextResponse.json({ invoices });
  } catch (error) {
    // fetchInvoices now throws rather than returning an empty list on a failed query, so this
    // reports the cause instead of the screen quietly claiming there are no invoices.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load invoices" },
      { status: 500 },
    );
  }
}
