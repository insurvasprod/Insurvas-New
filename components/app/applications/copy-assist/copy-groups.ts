/**
 * Copy-assist's view of an attempt (LA-3.14): the application's values regrouped the way a carrier's
 * form asks for them, each with the exact string to paste. Pure — the inline panel, the pop-out
 * window and (later) the extension side panel all build from this one function.
 *
 * Sensitive values are never here in plain text: a sensitive item carries only its mask, and the
 * build fetches the value through the one-field reveal call at the moment it is copied.
 *
 * No client-only imports: /api/app/extension/fields builds the extension's copy list from this
 * same function on the server, so it must stay importable there.
 */

import {
  BENEFICIARY_RELATIONSHIP_LABEL, CANONICAL_GROUPS, PAYMENT_METHOD_LABEL, type CanonicalField,
} from "@/lib/applications/constants";
import { formatShare } from "@/lib/applications/beneficiaries";
import { dobVariants, phoneVariants } from "@/lib/applications/formats";
import type { AttemptView } from "@/lib/applications/types";
import { formatCentsAsCurrency } from "@/lib/money";

// A copy of parts.tsx's `ordinal`: parts.tsx is a client module and the server builds from this file.
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

export type CopyVariant = { label: string; value: string };

export type CopyItem = {
  /** Unique within the attempt — the progress tick is keyed by it. */
  key: string;
  label: string;
  /** How the toast names it: "Copied date of birth". */
  name: string;
  /** What the row shows; null = nothing on file. */
  display: string | null;
  /** What one click puts on the clipboard; null for a sensitive value (fetched on copy). */
  copy: string | null;
  variants?: CopyVariant[];
  sensitive?: { masked: string };
  /** A sub-heading inside the group (one per beneficiary). */
  section?: string;
};

export type CopyGroup = { key: string; label: string; items: CopyItem[] };

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
const dollars = (cents: number) => (cents / 100).toFixed(2);

function withVariants(all: string[]): Pick<CopyItem, "display" | "copy" | "variants"> {
  const [first, ...rest] = all;
  return { display: first, copy: first, variants: rest.map((v) => ({ label: v, value: v })) };
}

function field(attempt: AttemptView, f: CanonicalField, name = lower(f.label)): CopyItem {
  const fv = attempt.values[f.key];
  const base: CopyItem = { key: f.key, label: f.label, name, display: null, copy: null };
  if (f.sensitive) {
    return fv?.hasValue ? { ...base, display: fv.masked ?? "••••", sensitive: { masked: fv.masked ?? "••••" } } : base;
  }
  const v = fv?.value;
  if (v === null || v === undefined || v === "") return base;
  if (f.input === "date" && typeof v === "string") return { ...base, ...withVariants(dobVariants(v)) };
  if (f.input === "tel") return { ...base, ...withVariants(phoneVariants(String(v))) };
  if (f.input === "boolean") return { ...base, display: v ? "Yes" : "No", copy: v ? "Yes" : "No" };
  if (f.input === "money" && typeof v === "number") {
    // The face amount goes in whole dollars; a premium keeps its cents.
    const isFace = f.key === "cov.face_amount";
    return { ...base, display: isFace ? `$${Math.round(v / 100).toLocaleString("en-US")}` : formatCentsAsCurrency(v), copy: isFace ? String(Math.round(v / 100)) : dollars(v) };
  }
  if (f.input === "select" && f.options) {
    const label = f.options.find((o) => o.value === v)?.label ?? String(v);
    return { ...base, display: label, copy: label };
  }
  return { ...base, display: String(v), copy: String(v) };
}

const byKey = (groupKey: string) => CANONICAL_GROUPS.find((g) => g.key === groupKey)?.fields ?? [];
const one = (groupKey: string, key: string) => byKey(groupKey).find((f) => f.key === key);

const NAMES: Record<string, string> = {
  "insured.ssn": "Social Security number",
  "insured.dob": "date of birth",
  "addr.zip": "ZIP",
  "contact.phone": "phone",
  "contact.email": "email",
  "owner.dob": "owner's date of birth",
};

function text(key: string, label: string, value: string | null | undefined, name = lower(label), section?: string): CopyItem {
  return { key, label, name, display: value || null, copy: value || null, section };
}

function masked(key: string, label: string, name: string, v: { masked: string; hasValue: boolean } | undefined): CopyItem {
  return v?.hasValue
    ? { key, label, name, display: v.masked, copy: null, sensitive: { masked: v.masked } }
    : { key, label, name, display: null, copy: null };
}

export function buildCopyGroups(attempt: AttemptView): CopyGroup[] {
  const f = (groupKey: string) => byKey(groupKey).map((x) => field(attempt, x, NAMES[x.key]));

  const ownerIsInsured = attempt.values["owner.same_as_insured"]?.value !== false;
  const ownerSame = one("owner", "owner.same_as_insured");
  const owner = ownerIsInsured
    ? (ownerSame ? [field(attempt, ownerSame)] : [])
    : f("owner");

  const coverage: CopyItem[] = [
    text("cov.product", "Product", attempt.productLabel),
    ...f("cov"),
  ];

  const beneficiaries: CopyItem[] = [];
  (["primary", "contingent"] as const).forEach((tier) => {
    attempt.beneficiaries.filter((b) => b.tier === tier).forEach((b, i) => {
      const section = `${tier === "primary" ? "Primary" : "Contingent"} ${i + 1}`;
      // Tick keys follow the canonical `group.field` shape the ticks table accepts: ben.primary1_name.
      const k = (field: string) => `ben.${tier}${i + 1}_${field}`;
      const who = `${section.toLowerCase()} beneficiary`;
      const relationship = b.relationship === "other" ? b.relationship_other ?? "Other" : b.relationship ? BENEFICIARY_RELATIONSHIP_LABEL[b.relationship] : null;
      beneficiaries.push(
        text(k("name"), "Name", `${b.first_name} ${b.last_name}`.trim(), `${who}'s name`, section),
        text(k("relationship"), "Relationship", relationship, `${who}'s relationship`, section),
        b.dob
          ? { key: k("dob"), label: "Date of birth", name: `${who}'s date of birth`, section, ...withVariants(dobVariants(b.dob)) }
          : text(k("dob"), "Date of birth", null, `${who}'s date of birth`, section),
        text(k("share"), "Share", `${formatShare(b.share_bp).replace(/\.00$/, "")}%`, `${who}'s share`, section),
      );
    });
  });

  const p = attempt.payment;
  const payment: CopyItem[] = [];
  if (p) {
    payment.push(text("pay.method", "Payment method", PAYMENT_METHOD_LABEL[p.method]));
    if (p.method === "ach") {
      payment.push(
        text("pay.bank_name", "Bank name", p.bankName),
        text("pay.account_type", "Account type", p.accountType === "savings" ? "Savings" : p.accountType === "checking" ? "Checking" : null),
        text("pay.name_on_account", "Name on account", p.nameOnAccount),
        masked("pay.routing_number", "Routing number", "routing number", p.routing),
        masked("pay.account_number", "Account number", "account number", p.account),
      );
    }
    if (p.method === "debit_card" || p.method === "credit_card" || p.method === "direct_express") {
      const exp = p.card?.expMonth && p.card?.expYear ? { m: String(p.card.expMonth).padStart(2, "0"), y: String(p.card.expYear) } : null;
      payment.push(
        text("pay.name_on_card", "Name on card", p.nameOnCard),
        masked("pay.card_number", "Card number", "card number", p.card),
        exp
          ? { key: "pay.card_exp", label: "Expiry", name: "card expiry", ...withVariants([`${exp.m}/${exp.y.slice(2)}`, `${exp.m}/${exp.y}`]) }
          : text("pay.card_exp", "Expiry", null, "card expiry"),
      );
    }
    payment.push(
      p.draftDay
        ? { key: "pay.draft_day", label: "Draft day", name: "draft day", display: `${ordinal(p.draftDay)} of the month`, copy: String(p.draftDay) }
        : text("pay.draft_day", "Draft day", null),
      text("pay.billing_frequency", "Billing frequency", p.billingFrequency ? p.billingFrequency.charAt(0).toUpperCase() + p.billingFrequency.slice(1) : "Monthly"),
    );
  }

  return [
    { key: "insured", label: "Proposed insured", items: f("insured") },
    // Carrier forms ask for the phone and email on the address page.
    { key: "addr", label: "Address", items: [...f("addr"), ...f("contact")] },
    { key: "owner", label: "Owner", items: owner },
    { key: "cov", label: "Coverage", items: coverage },
    { key: "ben", label: "Beneficiaries", items: beneficiaries },
    { key: "pay", label: "Banking and payment", items: payment },
  ];
}
