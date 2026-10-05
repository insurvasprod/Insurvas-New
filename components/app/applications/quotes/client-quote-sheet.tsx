/**
 * The client-facing comparison (LA-3.5; board l3-quotes-print). What the client may see and
 * nothing else: carrier, product, monthly premium, coverage, and what it pays early and later in
 * plain words. There is no per-$1,000, commission, advance or appointment anywhere in this file —
 * it is never given them. Server-rendered; no motion classes — it is printed.
 */

import type { ReactNode } from "react";

import { formatCentsAsCurrency } from "@/lib/money";
import { comparisonNote, dollars, headline, intro, nextSteps, whatItPays, type PrintQuote } from "@/lib/quotes/plainWords";

import { PrintButton } from "./print-button";

export type ClientSheetProps = {
  agencyName: string | null;
  productLine: string | null;
  /** Full name on "Prepared for". */
  clientName: string;
  /** How the sheet refers to the insured in sentences ("Grace"). */
  callName: string;
  dateLabel: string;
  quotes: PrintQuote[];
  draftDay: number | null;
  agent: { name: string | null; phone: string | null; licence: string | null } | null;
  notice?: ReactNode;
};

const label = "text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)] print:text-neutral-600";

export function ClientQuoteSheet({ agencyName, productLine, clientName, callName, dateLabel, quotes, draftDay, agent, notice }: ClientSheetProps) {
  const cols = quotes.length >= 3 ? "sm:grid-cols-3" : quotes.length === 2 ? "sm:grid-cols-2" : "";
  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] print:bg-white print:text-black">
      <div className="mx-auto flex max-w-[816px] flex-col gap-6 px-4 pt-6 pb-8 sm:px-8 print:max-w-none print:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="min-w-0 flex-1">{notice}</div>
          <PrintButton />
        </div>

        <article className="flex flex-col gap-6 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-6 py-7 sm:px-[34px] sm:py-[30px] print:rounded-none print:border-0 print:p-0">
          <header className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-[var(--ink)] pb-4 print:border-black">
            <div className="flex items-center gap-[11px]">
              {agencyName && (
                <span aria-hidden="true" className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--primary)] text-lg font-semibold text-[var(--ink)] print:border print:border-black print:bg-white">
                  {agencyName.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="flex flex-col">
                {agencyName && <span className="text-lg font-semibold">{agencyName}</span>}
                {productLine && <span className="text-xs text-[var(--muted)] print:text-neutral-600">{productLine}</span>}
              </span>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">Prepared for {clientName}</div>
              <div className="text-xs text-[var(--muted)] print:text-neutral-600">{dateLabel}</div>
            </div>
          </header>

          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{headline(quotes)}</h1>
            {quotes.length > 0 && <p className="text-base text-[var(--body)] print:text-black">{intro(quotes, callName)}</p>}
          </div>

          {quotes.length === 0 ? (
            <p className="text-base text-[var(--body)]">There are no options to show yet.</p>
          ) : (
            <div className={`grid gap-4 ${cols}`}>
              {quotes.map((q) => {
                const words = whatItPays(q, callName);
                const note = comparisonNote(q, quotes);
                return (
                  <section key={q.id} className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-[18px] print:break-inside-avoid print:border-neutral-400">
                    <div>
                      <div className="text-lg font-semibold">{q.carrierName}</div>
                      <div className="text-sm text-[var(--muted)] print:text-neutral-600">{q.productLabel}</div>
                    </div>
                    <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-3 print:border-neutral-400">
                      <div className={label}>Monthly premium</div>
                      <div className="text-2xl font-semibold tabular-nums">{formatCentsAsCurrency(q.monthlyPremiumCents)}</div>
                      {q.termLength && q.annualPremiumCents ? <div className="text-sm text-[var(--body)]">or {formatCentsAsCurrency(q.annualPremiumCents)} a year</div> : null}
                      <div className={`${label} mt-2`}>Coverage</div>
                      <div className="text-lg font-semibold tabular-nums">{dollars(q.faceAmountCents)}{q.termLength ? ` for ${q.termLength} years` : ""}</div>
                    </div>
                    <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-3 print:border-neutral-400">
                      <div className={label}>{words.firstLabel}</div>
                      <div className="text-sm text-[var(--body)] print:text-black">{words.first}</div>
                      <div className={`${label} mt-2`}>{words.afterLabel}</div>
                      <div className="text-sm text-[var(--body)] print:text-black">{words.after}</div>
                    </div>
                    {note && <div className="text-xs text-[var(--muted)] print:text-neutral-600">{note}</div>}
                  </section>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-5 print:border-neutral-400">
            <h2 className="text-lg font-semibold">What happens next</h2>
            <p className="text-base text-[var(--body)] print:text-black">{nextSteps(callName, draftDay)}</p>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-[var(--border)] pt-4 print:border-neutral-400">
            {agent ? (
              <span className="text-sm text-[var(--body)] print:text-black">
                {agent.name && <strong className="font-semibold text-[var(--ink)] print:text-black">{agent.name}</strong>}
                {agent.name && (agent.licence || agent.phone) ? " · " : ""}
                {[agent.licence, agent.phone].filter(Boolean).join(" · ")}
              </span>
            ) : <span />}
            <span className="text-xs text-[var(--muted)] print:text-neutral-600">Quotes valid 30 days · not a contract</span>
          </footer>
        </article>
      </div>
    </main>
  );
}
