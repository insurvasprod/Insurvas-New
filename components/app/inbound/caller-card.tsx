"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Cake, Check, Clock3, Copy, Handshake, Languages, Mail, MapPin, Package, Phone, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { languageFromLeadValues, phoneFromLeadValues } from "@/lib/agentFloor/leadFacts";
import { productLineLabel } from "@/lib/format/productLine";
import { cn } from "@/lib/utils";

/**
 * The caller on the left of the call steps (owner 2026-10-27: the same card on each): who is on the
 * line, their phone, email, date of birth and address (owner 2026-10-28, in place of the screening),
 * the product, where the call came from and how long it has run.
 */

export type CallerFacts = {
  name: string; product: string; from: string; takenBy: string; callStartedAt: string | null;
  /** From the lead (owner 2026-10-28: the phone first, then what verification reads back). */
  phone: string | null; email: string | null; dob: string | null; livesIn: string | null; language: string | null;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** "Mar 14, 1953 · 72" from a stored date of birth; the stored text when it is not a date. */
function dobLine(raw: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  if (today.getUTCMonth() < date.getUTCMonth() || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())) age -= 1;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · ${age}`;
}

/** The lead's contact facts, from its stored values (any of the keys partners send). */
export function contactFacts(values: Record<string, unknown>) {
  const dob = text(values.date_of_birth) || text(values.dob) || text(values.birth_date);
  const place = [text(values.city), text(values.state)].filter(Boolean).join(", ");
  const street = text(values.address) || text(values.street_address) || text(values.address_line1);
  return {
    phone: phoneFromLeadValues(values),
    email: text(values.email) || text(values.email_address) || null,
    dob: dob ? dobLine(dob) : null,
    livesIn: [street, place, text(values.zip) || text(values.zip_code) || text(values.postal_code)].filter(Boolean).join(", ") || null,
    language: languageFromLeadValues(values),
  };
}

type PanelLike = {
  workItem: { productLine: string };
  lead: { values: Record<string, unknown> };
  template: { product_name: string };
  context?: { claim: { at: string | null; byName: string | null; isYou: boolean }; partnerName: string | null; callStartedAt: string | null } | null;
};

export function clock(value: string | null | undefined) { return value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"; }

export function elapsed(from: string, now: number) {
  const total = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // A call open for days was never finished; an hour count that long hides that.
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/** The card's facts from the verification panel (GET /api/app/inbound/verification). */
export function callerFacts(panel: PanelLike): CallerFacts {
  const values = panel.lead.values;
  const context = panel.context ?? null;
  return {
    name: String(values.full_name ?? values.name ?? ([values.first_name, values.last_name].filter(Boolean).join(" ") || "Customer")),
    product: panel.template.product_name || productLineLabel(panel.workItem.productLine),
    from: context?.partnerName ?? String(values.source ?? values.lead_source ?? "Partner transfer"),
    takenBy: context?.claim.byName ? `${context.claim.isYou ? "You" : context.claim.byName}, ${clock(context.claim.at)}` : "—",
    callStartedAt: context?.callStartedAt ?? null,
    ...contactFacts(values),
  };
}

/** Counts up once a second while there is an open call. */
export function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/** A fact about the call: an icon, a small label, the value. */
function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-soft)] text-[var(--accent-ink)]"><Icon className="size-4" /></span>
      <span className="min-w-0">
        <span className="block text-xs leading-[1.33] text-[var(--body)]">{label}</span>
        <span className="block truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]" title={typeof value === "string" ? value : undefined}>{value}</span>
      </span>
    </div>
  );
}

const label12 = "text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--body)]";

/** The phone, large, with Copy (owner 2026-10-28: "their phone number, that's really important"). */
function PhoneLine({ phone }: { phone: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] bg-[var(--primary-soft)] px-3 py-2.5">
      <Phone className="size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs leading-[1.33] font-semibold text-[var(--accent-ink)]">Phone</span>
        {phone
          // Plain text, not a dial link: a call goes through the dialer's gates (calling window, do-not-call).
          ? <span className="block truncate text-lg leading-[1.3] font-semibold tracking-[-0.01em] text-[var(--ink)] tabular-nums select-all">{phone}</span>
          : <span className="block text-sm font-semibold text-[var(--ink)]">Not on the lead</span>}
      </span>
      {phone && (
        <Button type="button" size="icon" variant="ghost" aria-label={copied ? "Copied" : "Copy the phone number"} title={copied ? "Copied" : "Copy"} onClick={() => { void navigator.clipboard?.writeText(phone).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      )}
    </div>
  );
}

// `workItemId` stays in the signature for the callers; the screening block it fed is gone (owner 2026-10-28).
export function CallerCard({ facts, now }: { workItemId: string; facts: CallerFacts | null; now: number }) {
  const onTheCall = facts?.callStartedAt ? elapsed(facts.callStartedAt, now) : null;
  const name = facts?.name ?? "";
  return (
    <section className="m-glass flex min-w-0 flex-col rounded-[16px] border border-[var(--border)]">
      <div className="flex items-center gap-3 p-4">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-base font-semibold text-[var(--accent-ink)]" aria-hidden="true">{name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "·"}</span>
        <span className="min-w-0">
          <span className={cn(label12, "block")}>On the line</span>
          <strong className="block truncate text-title-sm leading-[1.3] font-semibold tracking-[-0.015em] text-[var(--ink)]">{name || <span aria-hidden="true" className="block h-5 w-40 animate-pulse rounded bg-[var(--surface-alt)]" />}</strong>
        </span>
      </div>
      {/* Owner 2026-10-28: the screening block gave way to the caller's own details, phone first. */}
      <div className="flex flex-col gap-3 border-t border-[var(--border)] p-4">
        <PhoneLine phone={facts?.phone ?? null} />
        <Fact icon={Mail} label="Email" value={facts?.email ?? "Not on the lead"} />
        <Fact icon={Cake} label="Date of birth" value={facts?.dob ?? "Not on the lead"} />
        <Fact icon={MapPin} label="Lives in" value={facts?.livesIn ?? "Not on the lead"} />
        {facts?.language && <Fact icon={Languages} label="Speaks" value={facts.language} />}
      </div>
      <div className="flex flex-col gap-3 border-t border-[var(--border)] p-4">
        <Fact icon={Package} label="Product" value={facts?.product ?? "—"} />
        <Fact icon={Handshake} label="From" value={facts?.from ?? "—"} />
        <Fact icon={Clock3} label="On the call" value={onTheCall ?? "No open call record"} />
      </div>
    </section>
  );
}

/** The card on a page that does not already hold the verification panel (Finish the call). */
export function CallerCardForCall({ workItemId }: { workItemId: string }) {
  const [facts, setFacts] = useState<CallerFacts | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/inbound/verification?work_item_id=${encodeURIComponent(workItemId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? callerFacts(await response.json() as PanelLike) : null))
      .catch(() => null)
      .then((value) => { if (live && value) setFacts(value); });
    return () => { live = false; };
  }, [workItemId]);
  const now = useNow(Boolean(facts?.callStartedAt));
  return <CallerCard workItemId={workItemId} facts={facts} now={now} />;
}
