"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Info } from "lucide-react";
import { useRouter } from "next/navigation";

import { authControl, authLabel } from "@/components/app/auth-card";
import { FunnelHeading, FunnelStepFooter } from "@/components/app/funnel-frame";
import { StatePicker } from "@/components/app/state-picker";
import { PhoneField } from "@/components/public/phone-field";
import { LEAD_SOURCE_OPTIONS, PRODUCT_OPTIONS, VOLUME_OPTIONS } from "@/lib/signup/constants";
import { DEFAULT_PHONE_COUNTRY, checkPhone } from "@/lib/signup/phone";
import { cn } from "@/lib/utils";

const chip = (on: boolean) =>
  cn(
    "min-h-10 rounded-full px-3.5 text-sm font-semibold tracking-[-0.02em] transition-colors duration-150",
    on ? "border-[1.5px] border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border border-[var(--border-strong)] bg-card text-[var(--body)] hover:border-[var(--accent-ink)]",
  );

/** Free mailboxes say nothing about the agency's name; a company domain usually does. */
const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com"]);

/** "dana@northline-life.com" → "Northline Life". Empty for a personal mailbox. */
export function nameFromEmail(email: string | null | undefined) {
  const domain = (email ?? "").split("@")[1]?.toLowerCase() ?? "";
  if (!domain || PERSONAL_DOMAINS.has(domain)) return "";
  const label = domain.split(".")[0] ?? "";
  return label.split(/[-_]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

/**
 * What each field needs, one short sentence (owner, 2026-10-26: "an informational icon that explains
 * each field"; then: shown on hover, not as a card that pushes the form down).
 */
const FIELD_INFO = {
  name: "Your agency's legal name, or the DBA your clients know you by.",
  state: "The main state your agency will operate in. Type its name or two-letter code.",
  sell: "Every product line your agency writes. Pick as many as apply.",
  volume: "Roughly how many applications the whole agency submits a month.",
  sources: "Where your leads come from today. Pick all that apply.",
} as const;
type InfoKey = keyof typeof FIELD_INFO;

/** A field's label with its (i). Hover or focus shows the hint floating above, so nothing below moves. */
function FieldLabel({ id, label }: { id: InfoKey; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={authLabel}>{label}</span>
      <span className="group relative inline-flex">
        <button
          type="button"
          aria-label={`What ${label.toLowerCase()} needs`}
          aria-describedby={`info-${id}`}
          // A tap focuses it, which shows the hint on a touch screen where there is no hover.
          onClick={(event) => event.currentTarget.focus()}
          className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[var(--accent-ink)] focus-visible:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
        <span
          id={`info-${id}`}
          role="tooltip"
          className="pointer-events-none invisible absolute bottom-full -left-2 z-20 mb-1.5 w-64 rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)] px-3 py-2 text-xs font-normal leading-normal text-[var(--body)] opacity-0 shadow-[var(--shadow-overlay,0_12px_30px_rgba(0,0,0,.35))] transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          {FIELD_INFO[id]}
        </span>
      </span>
    </span>
  );
}

export type BusinessProfileInitial = {
  businessName: string;
  primaryState: string;
  productsSold: string[];
  monthlyVolumeRange: string;
  leadSources: string[];
  leadSourceOther: string | null;
};

/**
 * Step 3 of 5. The answers decide the setup checklist shown after checkout; the server derives it
 * when it saves the profile.
 *
 * `initial`: the saved profile, when the owner comes back to correct it while checkout is pending.
 * `email`: the owner's address, to suggest the business name from its domain on a first visit.
 */
export function BusinessProfileForm({ initial = null, email = null, fullName = "", phone = "", backHref = "/app/onboarding/plan", audience = null, postPayment = false }: { initial?: BusinessProfileInitial | null; email?: string | null; fullName?: string; phone?: string; backHref?: string; audience?: "individual" | "agency" | null; postPayment?: boolean }) {
  const router = useRouter();
  const suggested = initial ? "" : nameFromEmail(email);
  const [businessName, setBusinessName] = useState(initial?.businessName ?? suggested);
  const isPlaceholderName = fullName.trim() === "New user";
  const nameParts = fullName.trim().split(/\s+/);
  const initialFirstName = isPlaceholderName ? "" : nameParts.shift() ?? "";
  const initialLastName = isPlaceholderName ? "" : nameParts.join(" ");
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const parsedPhone = parsePhoneNumberFromString(phone);
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>(parsedPhone?.country ?? DEFAULT_PHONE_COUNTRY);
  const [phoneValue, setPhoneValue] = useState(parsedPhone?.formatNational() ?? phone);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const label = (id: InfoKey, text: string): ReactNode => <FieldLabel id={id} label={text} />;
  const [primaryState, setPrimaryState] = useState(initial?.primaryState ?? "");
  const [products, setProducts] = useState<string[]>(initial?.productsSold ?? []);
  const [volume, setVolume] = useState(initial?.monthlyVolumeRange ?? "");
  const [leadSources, setLeadSources] = useState<string[]>(initial?.leadSources ?? []);
  const [leadSourceOther, setLeadSourceOther] = useState(initial?.leadSourceOther ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const phoneCheck = checkPhone(phoneCountryCode, phoneValue);

  const missing = [
    businessName.trim().length < 2 && "business name",
    !postPayment && !firstName.trim() && "first name",
    !postPayment && !lastName.trim() && "last name",
    !postPayment && !phoneCheck.ok && phoneCheck.error,
    !primaryState && "primary state",
    products.length === 0 && "a product",
    !volume && "monthly applications",
    leadSources.length === 0 && "a lead source",
    leadSources.includes("other") && !leadSourceOther.trim() && "the other lead source",
  ].filter(Boolean) as string[];

  function toggle(value: string, current: string[], set: (next: string[]) => void) {
    set(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  // One way out of this step (2026-10-26, owner: "remove save and exit"): save, then the plan step.
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (missing.length) { setError(`Still needed: ${missing.join(", ")}.`); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/app/onboarding/business-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(!postPayment ? { firstName: firstName.trim(), lastName: lastName.trim(), phone: phoneCheck.ok ? phoneCheck.e164 : "" } : {}), businessName, primaryState, productsSold: products, monthlyVolumeRange: volume, leadSources, leadSourceOther: leadSources.includes("other") ? leadSourceOther : null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not save your business profile"); return; }
      router.push(body?.redirectTo ?? (postPayment ? "/app/onboarding/complete" : "/app/onboarding/plan"));
      router.refresh();
    } catch {
      setError("Could not save your business profile. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function skipForNow() {
    setSkipping(true);
    setError(null);
    try {
      const response = await fetch("/api/app/onboarding/business-profile/skip", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not finish setup right now."); return; }
      router.push(body?.redirectTo ?? "/app/onboarding/complete");
      router.refresh();
    } catch {
      setError("Could not reach Insurvas. Check your connection and try again.");
    } finally {
      setSkipping(false);
    }
  }

  return (
    <div>
      {/* Owner pick A, 2026-10-26: no subtitle and no setup preview; the NPN is asked later in Settings. */}
      <div className="mb-7"><FunnelHeading title={postPayment ? "Set up your business profile" : audience === "agency" ? "Tell us about your agency" : "Tell us about you"}>{postPayment ? "These details help tailor your workspace. You can finish this now or come back to it later." : audience === "agency" ? "Share a few details about your agency so we can tailor the workspace for your team." : "Add your personal details first, then we’ll tailor your workspace to the business you run."}</FunnelHeading></div>
      <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-5">
        {!postPayment && <fieldset className="flex flex-col gap-4">
          <legend className="text-base font-semibold text-foreground">About you</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block"><span className={authLabel}>First Name</span><input className={authControl} autoComplete="given-name" maxLength={60} required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
            <label className="block"><span className={authLabel}>Last Name</span><input className={authControl} autoComplete="family-name" maxLength={60} required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
          </div>
          <div><label htmlFor="business-phone" className={authLabel}>Phone Number</label>
            <PhoneField id="business-phone" country={phoneCountryCode} onCountryChange={setPhoneCountryCode} number={phoneValue} onNumberChange={setPhoneValue} onBlur={() => setPhoneTouched(true)} invalid={phoneTouched && !phoneCheck.ok} describedBy="about-phone-note" />
            <span id="about-phone-note" className="mt-1.5 block text-xs text-muted-foreground">Used for your account and payment support{phoneTouched && !phoneCheck.ok ? ` · ${phoneCheck.error}` : "."}</span>
          </div>
        </fieldset>}

        <fieldset className="flex flex-col gap-5">
          <legend className="text-base font-semibold text-foreground">Your business</legend>
        {/* Name and state side by side on a wide screen: the step fits without scrolling (2026-10-26). */}
        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
        <div>
          {label("name", "Business Name")}
          <input className={authControl} aria-label="Business Name" autoComplete="organization" maxLength={160} value={businessName} onChange={(event) => setBusinessName(event.target.value)} aria-describedby={suggested ? "business-name-note" : undefined} />
          {suggested && businessName === suggested && <span id="business-name-note" className="mt-1.5 block text-xs text-muted-foreground">Taken from your email address. Change it if it is not right.</span>}
        </div>

        <div>
          {label("state", "Primary State")}
          <StatePicker value={primaryState} onChange={setPrimaryState} />
        </div>
        </div>

        <fieldset>
          <legend className="contents">{label("sell", "What You Sell")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRODUCT_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={products.includes(option.value)} className={chip(products.includes(option.value))} onClick={() => toggle(option.value, products, setProducts)}>{option.label}</button>)}
          </div>
        </fieldset>

        <fieldset>
          <legend className="contents">{label("volume", "Applications a Month")}</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Applications a Month">
            {VOLUME_OPTIONS.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={volume === option.value} className={chip(volume === option.value)} onClick={() => setVolume(option.value)}>
                {option.label.replace(/\s*applications\s*\/\s*month$/, "")}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="contents">{label("sources", "Where Your Leads Come From")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {LEAD_SOURCE_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={leadSources.includes(option.value)} className={chip(leadSources.includes(option.value))} onClick={() => toggle(option.value, leadSources, setLeadSources)}>{option.label}</button>)}
          </div>
        </fieldset>
        {leadSources.includes("other") && (
          <label className="block">
            <span className={authLabel}>Other Lead Source</span>
            <input className={authControl} maxLength={120} value={leadSourceOther} onChange={(event) => setLeadSourceOther(event.target.value)} />
          </label>
        )}
        </fieldset>

        {error && <p role="alert" className="rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{error}</p>}
        {postPayment ? (
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button type="submit" disabled={submitting || missing.length > 0} className="h-12 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1">{submitting ? "Saving…" : "Finish setup"}</button>
            <button type="button" disabled={submitting || skipping} onClick={() => void skipForNow()} className="h-12 w-full rounded-md border border-[var(--border-strong)] bg-card px-4 text-sm font-semibold text-foreground disabled:opacity-50 sm:flex-1">{skipping ? "Finishing…" : "Skip for now"}</button>
          </div>
        ) : <FunnelStepFooter backHref={backHref} disabled={submitting} busy={submitting} busyLabel="Saving…" />}
      </form>
    </div>
  );
}
