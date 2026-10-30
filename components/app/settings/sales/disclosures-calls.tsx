"use client";

/**
 * Settings › Disclosures › Read on the call (LA-2.23; board A, 2026-10-30). Read-only: per product and
 * state, the wording the dialer shows before Call — approved, still the seeded placeholder, or missing
 * (dialing that state is blocked). Insurvas compliance maintains it on /admin/state-disclosures; an
 * agency reads it here so nothing it dials is a surprise. A state opens in a sheet with its wording,
 * Copy wording, Ask support to change it, and arrows to the state before and after.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, LifeBuoy } from "lucide-react";

import { SettingsCard, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import type { CallProduct, CallStatus } from "@/lib/salesSettings/disclosureLibrary";
import { US_STATES } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

import { SalesLoadError, SalesLoading } from "./shared";

const SUPPORT = "support@insurvas.com";
const STATE_NAME = new Map(US_STATES.map(([code, name]) => [code as string, name as string]));
const STATUS: Record<CallStatus, { label: string; tone: StatusTone; tile: string }> = {
  // The code stays in the ink colour (owner: white text over grey); the state's colour is the tile's ground and edge.
  approved: { label: "Approved", tone: "good", tile: "border-[var(--success)] bg-[var(--success-surface)] text-[var(--ink)]" },
  placeholder: { label: "Placeholder", tone: "warning", tile: "border-[var(--warning)] bg-[var(--warning-surface)] text-[var(--ink)]" },
  missing: { label: "Missing · dialing blocked", tone: "danger", tile: "border-[var(--error)] bg-[var(--error-surface)] text-[var(--ink)]" },
};

export const productLabel = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ");

/** "23 Sep 2026", by hand (Node's ICU prints "Sept"). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

/** States whose call wording is not approved, on the product with the most coverage: the tab's count. */
export function callsNeedingWork(products: CallProduct[] | null) {
  const top = products?.[0];
  return top ? top.placeholder + top.missing : null;
}

type Show = "all" | CallStatus;

export function CallWording({ products, error, onRetry }: { products: CallProduct[] | null; error: string | null; onRetry: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [openState, setOpenState] = useState<string | null>(null);

  if (error) return <SalesLoadError message={error} onRetry={onRetry} />;
  if (!products) return <SalesLoading label="Loading the call wording" columns={3} />;
  if (!products.length) return <EmptyState title="No call wording yet" hint="Insurvas compliance publishes the wording agents read for each state." />;

  const product = products.find((p) => p.code === code) ?? products[0];
  const shown = product.states.filter((s) => show === "all" || s.status === show);
  const index = openState ? shown.findIndex((s) => s.state === openState) : -1;
  const open = index >= 0 ? shown[index] : null;
  const name = (state: string) => STATE_NAME.get(state) ?? state;
  const missing = product.states.filter((s) => s.status === "missing").map((s) => s.state);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify.done("Wording copied");
    } catch {
      notify.block("The wording could not be copied. Select it and copy it instead.");
    }
  };
  const ask = (state: string) => `mailto:${SUPPORT}?subject=${encodeURIComponent(`Call wording: ${name(state)}, ${productLabel(product.code)}`)}&body=${encodeURIComponent(`Please review the call disclosure for ${name(state)} (${productLabel(product.code)}).\n\nWhat should change:\n`)}`;

  return (
    <>
      <SettingsCard
        title="Read on the call"
        info="Agents read the wording for the lead's state before they can press Call, and confirm it; the confirmation is kept on the call attempt. Insurvas compliance maintains this wording, so it is read-only here."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--body)]">
              Product
              <select className={cn(control, "mt-0 w-auto min-w-[200px]")} value={product.code} onChange={(e) => { setCode(e.target.value); setOpenState(null); }}>
                {products.map((p) => <option key={p.code} value={p.code}>{productLabel(p.code)}{p.missing === p.states.length ? " · no wording" : ""}</option>)}
              </select>
            </label>
          </div>
          <Segmented<Show>
            label="Show states"
            value={show}
            onChange={(v) => { setShow(v); setOpenState(null); }}
            options={[
              { key: "all", label: "All", count: product.states.length },
              { key: "missing", label: "Missing", count: product.missing, tone: "danger" },
              { key: "placeholder", label: "Placeholder", count: product.placeholder },
              { key: "approved", label: "Approved", count: product.approved },
            ]}
          />
          {product.placeholder > 0 && <p className="m-0 text-sm text-[var(--warning-ink)]">Placeholder wording is not compliance-approved. Insurvas replaces it before telephony goes live; ask support if you need a state sooner.</p>}
          {product.missing > 0 && <p className="m-0 text-sm text-[var(--error-ink)]">{missing.length === product.states.length ? `No state has ${productLabel(product.code).toLowerCase()} wording yet, so these leads can't be dialed.` : `Leads in ${missing.join(", ")} can't be dialed until wording is published.`}</p>}
          {shown.length === 0 ? (
            <EmptyState title="No state here" hint="Pick All to see every state." />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5" role="list" aria-label={`${productLabel(product.code)} call wording by state`}>
              {shown.map((s) => (
                <div role="listitem" key={s.state}>
                  <button
                    type="button"
                    onClick={() => setOpenState(s.state)}
                    title={`${name(s.state)}: ${STATUS[s.status].label}`}
                    aria-label={`${name(s.state)}, ${STATUS[s.status].label}`}
                    className={cn("h-9 w-full rounded-md border font-mono text-sm font-semibold transition-transform duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]", STATUS[s.status].tile, s.state === openState && "outline-2 outline-offset-2 outline-[var(--ink)]")}
                  >
                    {s.state}{s.next ? "•" : ""}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="m-0 text-xs text-[var(--muted)]">A dot after a state means new wording is dated to start later.</p>
        </div>
      </SettingsCard>

      {open && (
        <Sheet
          title={`${name(open.state)} · ${productLabel(product.code)}`}
          status={<StatusChip tone={STATUS[open.status].tone}>{STATUS[open.status].label}</StatusChip>}
          onClose={() => setOpenState(null)}
          closeLabel="Close the state's wording"
          footer={
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={index <= 0} onClick={() => setOpenState(shown[index - 1].state)}><ChevronLeft aria-hidden="true" />{index > 0 ? shown[index - 1].state : "Previous"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpenState(null)}>Close</Button>
              <Button type="button" variant="ghost" size="sm" disabled={index >= shown.length - 1} onClick={() => setOpenState(shown[index + 1].state)}>{index < shown.length - 1 ? shown[index + 1].state : "Next"}<ChevronRight aria-hidden="true" /></Button>
            </div>
          }
        >
          {open.text ? (
            <>
              <p className="m-0 text-sm text-[var(--muted)]">In effect since {day(open.effectiveFrom!)}. Agents read this before each call to a {name(open.state)} lead and confirm it; the confirmation is kept on the call attempt.</p>
              <div className="m-glass-inset whitespace-pre-line rounded-lg border border-[var(--border)] p-4 text-base leading-[1.7] text-[var(--ink)]">{open.text}</div>
            </>
          ) : (
            <p className="m-0 text-sm text-[var(--error-ink)]">No wording is published for this state and product, so its leads cannot be dialed.</p>
          )}
          {open.next && <p className="m-0 text-sm text-[var(--body)]">New wording starts {day(open.next.effectiveFrom)}{open.next.approved ? " (approved)" : " (still placeholder)"}.</p>}
          <div className="flex flex-wrap gap-2">
            {open.text && <Button type="button" variant="outline" onClick={() => copy(open.text!)}><Copy aria-hidden="true" />Copy wording</Button>}
            <Button asChild variant="outline"><a href={ask(open.state)}><LifeBuoy aria-hidden="true" />Ask support to change it</a></Button>
          </div>
          <p className="m-0 text-xs text-[var(--muted)]">Insurvas compliance maintains this wording, so it is read-only for agencies.</p>
        </Sheet>
      )}
    </>
  );
}
