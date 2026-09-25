import "server-only";

import { notFound } from "next/navigation";
import Link from "next/link";

import { fetchInvoiceDetail } from "@/lib/invoices/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_LINE_KIND_LABELS, INVOICE_STATUS_LABELS } from "@/lib/invoices/constants";
import { PrintButton } from "@/components/admin/print-button";

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const long = (iso: string | null) => (iso ? LONG.format(new Date(iso)) : "—");
const bar = "inline-flex h-9 items-center justify-center rounded-[8px] border px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] no-underline";
const th = "px-3 py-2 text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[#60646c] print:text-black";
const td = "border-t border-[#ccd6e2] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[#33383f] print:text-black";

/**
 * SA-3.3 · The printable invoice (p-adm-invoice-print).
 *
 * Plain HTML with print CSS rather than a generated PDF: SA-3.2 put "PDF styling beyond a plain
 * printable page" out of scope, and Ctrl+P produces the PDF anyway. It shows OUR line items, which
 * is the point — the provider's own receipt cannot show a setup fee or an add-on it never knew
 * about.
 *
 * Paper, not screen: fixed dark-on-white colours rather than theme tokens, so dark mode never prints
 * a black page; no card grounds or shadows; the table header repeats on every printed page.
 * `data-print-hide` (see globals.css) keeps the app chrome and this page's own bar off the paper.
 *
 * Billed to is what we actually hold: the agency's legal name and principal address from its
 * profile when it has one, and the owner's name and email. The board's sender address is not shown
 * — the platform stores no postal address of its own, and a printed invoice must not invent one.
 */
export async function InvoicePrintView({ id }: { id: string }) {
  const detail = await fetchInvoiceDetail(id);
  if (!detail) notFound();
  const { invoice, lines } = detail;

  // Loosely typed: agency_profiles is not in the generated types yet.
  type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): { maybeSingle<T>(): PromiseLike<{ data: T | null }> } } } };
  const loose = getSupabaseServiceClient() as unknown as Loose;
  const db = getSupabaseServiceClient();
  const [profile, owner] = await Promise.all([
    loose.from("agency_profiles").select("legal_name, dba, principal_address").eq("tenant_id", invoice.tenant_id).maybeSingle<{ legal_name: string | null; dba: string | null; principal_address: string | null }>(),
    db.from("tenant_users").select("users(name, email)").eq("tenant_id", invoice.tenant_id).eq("role", "owner").not("accepted_at", "is", null).order("accepted_at").limit(1).maybeSingle<{ users: { name: string | null; email: string } | null }>(),
  ]);
  const billedName = profile.data?.legal_name?.trim() || invoice.tenant_name;
  const billedLines = [
    profile.data?.dba?.trim() && profile.data.dba.trim() !== billedName ? `Trading as ${profile.data.dba.trim()}` : null,
    ...(profile.data?.principal_address?.split(/\r?\n|,\s*(?=\S)/).map((part) => part.trim()).filter(Boolean) ?? []),
    owner.data?.users?.name?.trim() || null,
    owner.data?.users?.email ?? null,
  ].filter((line): line is string => Boolean(line));

  const netDays = invoice.issued_at && invoice.due_at ? Math.round((Date.parse(invoice.due_at) - Date.parse(invoice.issued_at)) / 86_400_000) : null;
  const provider = Boolean(invoice.provider_payment_id) || invoice.provider !== null;

  return (
    <div className="flex min-h-full flex-col bg-white p-6 text-[#15191e] sm:p-12 print:p-0">
      <div data-print-hide className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/admin/invoices/${invoice.id}`} className={`${bar} border-[#78838f] bg-white text-[#15191e] hover:bg-[#eef2f7]`}>Back to invoice</Link>
        <PrintButton className={`${bar} border-transparent bg-[var(--primary)] text-[var(--on-primary)]`}>Print or save as PDF</PrintButton>
      </div>

      <article className="mx-auto w-full max-w-[760px]">
        <header className="flex flex-wrap items-start justify-between gap-8">
          <div>
            <h1 className="m-0 text-[32px] leading-[1.13] font-semibold tracking-[-0.025em]">Insurvas</h1>
          </div>
          <div className="text-right">
            {/* "Invoice" is the document's own name, so it labels the number rather than sitting under the sender's name. */}
            <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[#60646c] print:text-black">Invoice</div>
            <div className="mt-1 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] tabular-nums">{invoice.number}</div>
            <p className="m-0 mt-3 text-[14px] leading-[1.5] text-[#33383f] tabular-nums print:text-black">
              Issued {long(invoice.issued_at)}<br />
              Due {long(invoice.due_at)}
              {invoice.status !== "issued" && <><br />{INVOICE_STATUS_LABELS[invoice.status]}</>}
            </p>
          </div>
        </header>

        <section className="mt-8 border-t border-[#d5dbe3] pt-6">
          <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[#60646c] print:text-black">Billed to</div>
          <p className="m-0 mt-2 text-[14px] leading-[1.5] text-[#33383f] print:text-black">
            <span className="font-semibold text-[#15191e]">{billedName}</span>
            {billedLines.map((line) => <span key={line}><br />{line}</span>)}
          </p>
        </section>

        <table className="mt-8 w-full border-collapse">
          <thead className="bg-[#dfe6ef] print:bg-transparent [display:table-header-group]">
            <tr>
              <th scope="col" className={`${th} text-left`}>Description</th>
              <th scope="col" className={`${th} w-[70px] text-right`}>Qty</th>
              <th scope="col" className={`${th} w-[110px] text-right`}>Unit</th>
              <th scope="col" className={`${th} w-[120px] text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="break-inside-avoid">
                <td className={td}>
                  {line.label}
                  <span className="text-[#60646c] print:text-black"> · {INVOICE_LINE_KIND_LABELS[line.kind]}</span>
                  {(line.kind === "plan" || line.kind === "addon") && invoice.period_start && invoice.period_end && <span className="text-[#60646c] print:text-black"> · {long(invoice.period_start)} – {long(new Date(Date.parse(invoice.period_end) - 1).toISOString())}</span>}
                  {line.included_qty !== null && <span className="text-[#60646c] print:text-black"> ({Number(line.included_qty).toLocaleString()} included)</span>}
                </td>
                <td className={`${td} text-right tabular-nums`}>{Number(line.quantity).toLocaleString()}</td>
                <td className={`${td} text-right tabular-nums`}>{formatCentsAsCurrency(line.unit_cents)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatCentsAsCurrency(line.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-[#dfe6ef] print:bg-transparent">
            {invoice.discount_cents > 0 && <tr><td colSpan={3} className={td}>Discount</td><td className={`${td} text-right tabular-nums`}>−{formatCentsAsCurrency(invoice.discount_cents)}</td></tr>}
            {invoice.tax_cents > 0 && <tr><td colSpan={3} className={td}>Tax</td><td className={`${td} text-right tabular-nums`}>{formatCentsAsCurrency(invoice.tax_cents)}</td></tr>}
            <tr>
              <td colSpan={3} className="border-t border-[#78838f] px-3 py-2.5 text-[14px] leading-[1.5] font-semibold text-[#15191e]">{invoice.status === "paid" ? "Total paid" : "Total due"}</td>
              <td className="border-t border-[#78838f] px-3 py-2.5 text-right text-[14px] leading-[1.5] font-semibold text-[#15191e] tabular-nums">{formatCentsAsCurrency(invoice.total_cents)} <span className="font-normal text-[#60646c] print:text-black">{invoice.currency.toUpperCase()}</span></td>
            </tr>
          </tfoot>
        </table>

        <p className="m-0 mt-8 text-[14px] leading-[1.5] text-[#33383f] print:text-black">
          {netDays !== null && netDays > 0 ? `Payment terms: net ${netDays}. ` : ""}
          {provider ? "Collected by the payment provider. " : ""}
          Questions: support@insurvas.com
        </p>

        {invoice.status === "void" && (
          <p className="m-0 mt-6 text-[14px] font-semibold tracking-[0.12em] uppercase text-[#60646c] print:text-black">
            Void{invoice.void_reason ? ` — ${invoice.void_reason}` : ""}
          </p>
        )}
      </article>
    </div>
  );
}
