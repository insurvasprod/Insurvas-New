import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { contractors, latestW9, payeePayments, producerRecordId, TaxError, taxSettings, type PayeePayment } from "@/lib/accounting/taxStore";
import { maskTaxId } from "@/lib/accounting/taxCore";
import { nextMissing, payeeHref, payeeKey, payeeTabOf, stepperList, whoOf, type TaxWho } from "@/lib/accounting/taxLinks";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { neighboursOf, RecordStepper } from "@/components/app/accounting/record-stepper";
import { ProfileForm, RevealTaxId, SaveTaxDetails, TaxNotice, TaxState, W9Drop } from "@/components/app/accounting/tax-board";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { StreamSection, TitleShape } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › Tax summaries › a payee (LA-7.8; round 7, owner 2026-11-10, mockups-r7/accounting.html 6·2–6·4): the
 * name on the form alone on the title line, with Details · Payments · W-9 as its tabs (`?tab=`), ‹ › naming the
 * neighbouring payees of the list it was opened from (`?from=`, a Contractors chip), Reveal tax ID (asked first,
 * audited, only for the roles the agency allows) and, on Details, Save. One strip under it: paid in the year, the
 * 1099 state, the tax ID masked, and who they are to you. Owner and bookkeeper only. Opening it writes nothing;
 * Reveal writes its audit row before the number is shown.
 */
const TYPES = ["partner", "producer", "vendor"] as const;
const TYPE_LABELS = { partner: "Partner", producer: "Producer", vendor: "Vendor" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (c: number) => formatCentsAsCurrency(c);
const readable = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function PayeePage({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ year?: string; from?: string; tab?: string }> }) {
  const guard = await guardPage("tax_summaries");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Tax summaries" description="What the accountant asks for, from your records." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Tax summaries" detail="Only owners and bookkeepers can see the agency's tax figures." />;
  const { type, id } = await params;
  const payeeType = TYPES.find((t) => t === type);
  if (!payeeType || !UUID.test(id)) notFound();
  const q = await searchParams;
  const year = /^\d{4}$/.test(q.year ?? "") ? Number(q.year) : new Date().getUTCFullYear();
  const tab = payeeTabOf(q.tab);
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const role = guard.role;
  const key = `${payeeType}/${id}`;
  // Frame first (UI-CONSISTENCY §7a): the payee is read now; the name streams in behind a title shape, and the tabs,
  // Save and the trail draw at once.
  const read: PayeeRead = (async () => {
    let first: { people: Awaited<ReturnType<typeof contractors>>; canReveal: boolean; payments: PayeePayment[] };
    try {
      const [settings, people, payments] = await Promise.all([taxSettings(tenantId), contractors(tenantId, year), payeePayments(tenantId, payeeType, id, year)]);
      first = { people, canReveal: settings.viewerRoles.includes(role), payments };
    } catch (error) {
      if (!(error instanceof TaxError)) throw error;
      return { loaded: null, problem: error.message };
    }
    // Under the threshold this year is still a contractor whose details can be kept.
    const c = first.people;
    const row = [...c.rows, ...c.under].find((r) => payeeKey(r) === key);
    if (!row) notFound();
    // The W-9 on file (LA-7.8 upload) and, for a producer, their record page: read side by side.
    const [w9, producerId] = await Promise.all([
      row.profileId ? latestW9(tenantId, row.profileId) : null,
      payeeType === "producer" ? producerRecordId(tenantId, id) : null,
    ]);
    // ‹ › walk the Contractors chip it was opened from, in that list's order; the tab stays.
    const list = stepperList(c, whoOf(q.from), key);
    const near = neighboursOf(list.rows, key, payeeKey);
    const step = (r: typeof row | null) => (r ? { href: payeeHref(r, year, { from: list.who, tab }), label: r.nameOnForm } : null);
    return { loaded: { ...first, row, w9, producerId, who: list.who, previous: step(near.previous), next: step(near.next) }, problem: null };
  })();
  const tabsOf = (who: TaxWho, payments: number | null, w9Missing: boolean) => {
    const at = (t: typeof tab) => payeeHref({ payeeType, payeeId: id }, year, { from: who, tab: t });
    return (
      <ViewTabs label="This payee" value={tab} tabs={[
        { key: "details", label: "Details", href: at("details") },
        { key: "payments", label: "Payments", count: payments, href: at("payments") },
        { key: "w9", label: "W-9", count: w9Missing ? 1 : null, tone: "danger", href: at("w9") },
      ]} />
    );
  };

  return (
    <AccountingPage
      step="tax"
      title={<Suspense fallback={<TitleShape />}><PayeeTitle read={read} /></Suspense>}
      tabs={<Suspense fallback={tabsOf(whoOf(q.from), null, false)}><PayeeTabs read={read} tabsOf={tabsOf} /></Suspense>}
      stepper={<Suspense fallback={<span aria-hidden="true" className="h-9" />}><PayeeStepper read={read} /></Suspense>}
      actions={<>
        <Suspense fallback={null}><PayeeReveal read={read} /></Suspense>
        {tab === "details" ? <SaveTaxDetails readOnly={readOnly} /> : null}
      </>}
    >
      <StreamSection shape={tab === "details" ? "form" : "strip+table"}>
        <PayeeBody read={read} payeeType={payeeType} id={id} year={year} tab={tab} readOnly={readOnly} />
      </StreamSection>
    </AccountingPage>
  );
}

type Row = Awaited<ReturnType<typeof contractors>>["rows"][number];
type PayeeRead = Promise<{
  loaded: {
    people: Awaited<ReturnType<typeof contractors>>;
    canReveal: boolean;
    payments: PayeePayment[];
    row: Row;
    w9: Awaited<ReturnType<typeof latestW9>> | null;
    producerId: Awaited<ReturnType<typeof producerRecordId>> | null;
    who: TaxWho;
    previous: { href: string; label: string } | null;
    next: { href: string; label: string } | null;
  } | null;
  problem: string | null;
}>;

async function PayeeTitle({ read }: { read: PayeeRead }) {
  const { loaded } = await read;
  return loaded ? loaded.row.nameOnForm : "Contractor";
}

async function PayeeTabs({ read, tabsOf }: { read: PayeeRead; tabsOf: (who: TaxWho, payments: number | null, w9Missing: boolean) => ReactNode }) {
  const { loaded } = await read;
  return loaded ? tabsOf(loaded.who, loaded.payments.length, loaded.row.missing.includes("W-9")) : null;
}

async function PayeeStepper({ read }: { read: PayeeRead }) {
  const { loaded } = await read;
  return loaded ? <RecordStepper noun="payee" previous={loaded.previous} next={loaded.next} /> : null;
}

async function PayeeReveal({ read }: { read: PayeeRead }) {
  const { loaded } = await read;
  const row = loaded?.row;
  return row?.profileId && row.profile?.taxIdLast4 && loaded?.canReveal ? <RevealTaxId profileId={row.profileId} name={row.nameOnForm} /> : null;
}

async function PayeeBody({ read, payeeType, id, year, tab, readOnly }: { read: PayeeRead; payeeType: (typeof TYPES)[number]; id: string; year: number; tab: ReturnType<typeof payeeTabOf>; readOnly: boolean }) {
  const { loaded, problem } = await read;
  if (!loaded) return <TableCard footer={<TaxNotice />}><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  const { people: c, row, w9, producerId } = loaded;
  const key = `${payeeType}/${id}`;
  const under = c.under.some((r) => payeeKey(r) === key);
  const next = nextMissing(c, key);
  const at = (t: typeof tab) => payeeHref(row, year, { from: loaded.who, tab: t });
  const recordHref = payeeType === "partner" ? `/app/publishers/${id}` : payeeType === "vendor" ? `/app/campaigns/vendors/${id}` : producerId ? `/app/producers/${producerId}` : null;
  const taxId = maskTaxId(row.profile?.taxIdType ?? "none", row.profile?.taxIdLast4 ?? null);
  const reversedNote = (p: PayeePayment) => (p.reversal ? "Reversal" : p.reversed ? "Reversed" : null);
  const forHref = (p: PayeePayment) => (p.invoiceId ? `/app/vendor-bills/${p.invoiceId}` : p.payoutRunId && p.entryType === "partner_payout" ? `/app/payouts/${p.payoutRunId}` : null);

  return (
    <>
    <StatStrip label="Payee">
      <StatTile label={`Paid in ${year}`} value={money(row.paidCents)} footnote={`${under ? "under" : "over"} the ${money(c.thresholdCents)} threshold`} href={at("payments")} />
      <StatTile label="1099" valueSize="text" value={under ? <StatusChip tone="neutral">Under the threshold</StatusChip> : <TaxState row={row} />} footnote={under || row.exempt ? "no 1099 needed" : row.missing.length ? "needed by January" : "ready for January"} />
      <StatTile label="Tax ID" valueSize="text" value={<span className="font-mono">{taxId}</span>} footnote={row.profile?.taxIdLast4 ? "stored encrypted" : "not on file yet"} />
      <StatTile label="Type" valueSize="text" value={TYPE_LABELS[payeeType]} footnote={recordHref ? <Link className="hover:underline" href={recordHref}>{row.displayName}&apos;s {payeeType === "partner" ? "partner" : payeeType} page</Link> : row.displayName} />
    </StatStrip>
    {tab === "details" ? (
      // Keyed on W-9 on file, so attaching a W-9 (which ticks it) redraws the form with the box ticked.
      <ProfileForm key={String(row.profile?.w9OnFile ?? false)} row={row} readOnly={readOnly} nextMissingHref={next ? payeeHref(next, year, { from: "missing" }) : null} />
    ) : tab === "w9" ? (
      <W9Drop profileId={row.profileId} name={row.nameOnForm} file={w9 ? { name: w9.name, uploadedAt: w9.uploadedAt } : null} readOnly={readOnly} />
    ) : (
      <TableCard footer={<div className="flex w-full flex-wrap items-center justify-between gap-3"><TaxNotice /><span className="shrink-0 text-xs text-muted-foreground">Counted by the date money moved</span></div>}>
        {loaded.payments.length === 0 ? <EmptyState title={`No payments in ${year}`} hint="Money paid to them is listed here once it is marked paid." /> : (
          <table className="portal-lead-table w-full min-w-[560px] text-left text-sm">
            <thead><tr><th className="w-[20%]">Paid</th><th>For</th><th className="w-[120px]">Kind</th><th className="w-[20%] text-right">Amount</th></tr></thead>
            <tbody>
              {loaded.payments.map((p) => {
                const href = forHref(p);
                const kind = reversedNote(p);
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap text-muted-foreground tabular-nums">{readable(p.paidOn)}</td>
                    <td className="whitespace-nowrap">{href ? <Link className="hover:underline" href={href}>{p.description}</Link> : p.description}</td>
                    <td>{kind ? <StatusChip tone="neutral">{kind}</StatusChip> : null}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{money(p.paidCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    )}
    </>
  );
}
