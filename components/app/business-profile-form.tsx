"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Info } from "lucide-react";
import { useRouter } from "next/navigation";

import { authControl, authLabel } from "@/components/app/auth-card";
import { AuthAlert } from "@/components/portal/auth-controls";
import { FunnelActions } from "@/components/portal/funnel-actions";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { MultiPicker } from "@/components/app/multi-picker";
import { StatePicker } from "@/components/app/state-picker";
import { PhoneCountryPicker } from "@/components/public/phone-country-picker";
import { Button } from "@/components/ui/button";
import { LEAD_SOURCE_OPTIONS, PRODUCT_OPTIONS, VOLUME_OPTIONS } from "@/lib/signup/constants";
import { checkPhone, phoneCountry, splitPhone } from "@/lib/signup/phone";
import { cn } from "@/lib/utils";

const chip = (on: boolean) =>
  cn(
    "min-h-10 rounded-full px-3.5 text-sm font-semibold tracking-[-0.02em] transition-colors duration-150",
    on ? "border-[1.5px] border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border border-[var(--border-strong)] bg-card text-[var(--body)] hover:border-[var(--accent-ink)]",
  );

/**
 * What each field needs, one short sentence (owner, 2026-10-26: "an informational icon that explains
 * each field"; then: shown on hover, not as a card that pushes the form down).
 */
const AGENCY_INFO = {
  name: "Your agency's legal name, or the DBA your clients know you by.",
  state: "The main state your agency will operate in. Type its name or two-letter code.",
  sell: "Every product line your agency writes. Pick as many as apply.",
  volume: "Roughly how many applications the whole agency submits a month.",
  sources: "Where your leads come from today. Pick all that apply.",
  phone: "The number we reach you on about your account. Never shown to your clients.",
} as const;
type InfoKey = keyof typeof AGENCY_INFO;

/** The same hints for one independent agent: "you", not "your agency". */
const AGENT_INFO: Record<InfoKey, string> = {
  name: "The name you do business under, if you have one. Leave it empty to use your own name.",
  state: "The main state you sell in. Type its name or two-letter code.",
  sell: "Every product line you write. Pick as many as apply.",
  volume: "Roughly how many applications you submit a month.",
  sources: "Where your leads come from today. Pick all that apply.",
  phone: AGENCY_INFO.phone,
};

/** A field's label with its (i). Hover or focus shows the hint floating above, so nothing below moves. */
function FieldLabel({ id, label, info, end = false }: { id: InfoKey; label: string; info: string; end?: boolean }) {
  return (
    // On a phone the hint spans the label row (the outer span is its box), so it never runs off the
    // screen; from 640px it sits by the (i), toward the inside of the column.
    <span className="relative flex items-center gap-1.5">
      <span className={authLabel}>{label}</span>
      <span className="group inline-flex sm:relative">
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
          className={cn("pointer-events-none invisible absolute bottom-full inset-x-0 z-20 mb-1.5 rounded-lg sm:right-auto sm:-left-2 sm:w-64 border border-[var(--border-strong)] bg-[var(--color-card)] px-3 py-2 text-xs font-normal leading-normal text-[var(--body)] opacity-0 shadow-[var(--shadow-overlay,0_12px_30px_rgba(0,0,0,.35))] transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100", end && "sm:left-auto sm:-right-2")}
        >
          {info}
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

/** The person, asked here since step 1 is only email and password (manager review, 2026-10-28). */
export type AboutYouInitial = { firstName: string; lastName: string; phone: string };

/**
 * Step 5 of 5, About you (after payment). The person (name, phone) and the business. The answers decide the setup
 * checklist shown after checkout; the server derives it when it saves the profile.
 *
 * `audience` is who signed up, from the plan picked on the pricing page: one independent agent reads
 * "Tell us about you" and may leave the business name empty; an agency reads "Tell us about your agency"
 * (manager review, 2026-10-28: "I started as an independent agent... it's common sense").
 *
 * `initial`: the saved profile, when the owner comes back to correct it while checkout is pending.
 * The name starts empty otherwise: guessing it from the email domain is gone (owner, 2026-10-27).
 */
export function BusinessProfileForm({ initial = null, person, audience = "agency", back }: {
  initial?: BusinessProfileInitial | null;
  person: AboutYouInitial;
  audience?: "individual" | "agency";
  /** The Back button beside Continue. */
  back?: string;
}) {
  const router = useRouter();
  const solo = audience === "individual";
  const info = solo ? AGENT_INFO : AGENCY_INFO;
  const [firstName, setFirstName] = useState(person.firstName);
  const [lastName, setLastName] = useState(person.lastName);
  const [phoneCountryCode, setPhoneCountryCode] = useState(() => splitPhone(person.phone).country);
  const [phone, setPhone] = useState(() => splitPhone(person.phone).national);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [businessName, setBusinessName] = useState(initial?.businessName ?? "");
  // A field in the right column opens its hint toward the left, so it never runs past the column
  // (owner, 2026-10-27: the page scrolled sideways at 125% Windows scaling).
  const label = (id: InfoKey, text: string, end = false): ReactNode => <FieldLabel id={id} label={text} info={info[id]} end={end} />;
  const [primaryState, setPrimaryState] = useState(initial?.primaryState ?? "");
  const [products, setProducts] = useState<string[]>(initial?.productsSold ?? []);
  const [volume, setVolume] = useState(initial?.monthlyVolumeRange ?? "");
  const [leadSources, setLeadSources] = useState<string[]>(initial?.leadSources ?? []);
  const [leadSourceOther, setLeadSourceOther] = useState(initial?.leadSourceOther ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneCheck = checkPhone(phoneCountryCode, phone);
  const phoneError = phoneTouched && !phoneCheck.ok ? phoneCheck.error : null;
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  // One agent without a business name does business under their own.
  const sentBusinessName = solo && businessName.trim().length < 2 ? fullName : businessName.trim();

  const missing = [
    !firstName.trim() && "first name",
    !lastName.trim() && "last name",
    !phoneCheck.ok && "phone number",
    sentBusinessName.length < 2 && (solo ? "business name" : "agency name"),
    !primaryState && "primary state",
    products.length === 0 && "a product",
    !volume && "monthly applications",
    leadSources.length === 0 && "a lead source",
    leadSources.includes("other") && !leadSourceOther.trim() && "the other lead source",
  ].filter(Boolean) as string[];

  // One way out of this step (2026-10-26, owner: "remove save and exit"): save, then the plan step.
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (missing.length) { setPhoneTouched(true); setError(`Still needed: ${missing.join(", ")}.`); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/app/onboarding/business-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phoneCheck.ok ? phoneCheck.e164 : undefined, businessName: sentBusinessName, primaryState, productsSold: products, monthlyVolumeRange: volume, leadSources, leadSourceOther: leadSources.includes("other") ? leadSourceOther : null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not save your business profile"); return; }
      router.push(body?.redirectTo ?? "/app/onboarding/plan");
      router.refresh();
    } catch {
      setError("Could not save your business profile. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* One line saying why (copy table, owner 2026-10-27); the NPN is asked later in Settings. */}
      <FunnelHeading title={solo ? "Tell us about you" : "Tell us about your agency"}>
        We use this to set up your workspace.
      </FunnelHeading>
      <form onSubmit={(event) => void save(event)} noValidate data-auth-fields="" className="flex flex-col gap-5">
        {/* Two to a row on a wide screen, so the step fits without scrolling (2026-10-26). */}
        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
          <label className="block">
            <span className={authLabel}>First name</span>
            <input className={authControl} autoComplete="given-name" maxLength={60} value={firstName} onChange={(event) => setFirstName(event.target.value)} />
          </label>
          <label className="block">
            <span className={authLabel}>Last name</span>
            <input className={authControl} autoComplete="family-name" maxLength={60} value={lastName} onChange={(event) => setLastName(event.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
          <div>
            {label("phone", "Phone number")}
            {/* One field, not two boxes side by side: the country code and the number share one border
                with a divider, so they always line up (owner, 2026-10-28: "the code is not in line"). */}
            <div
              className={cn(
                "mt-1.5 flex h-11 overflow-hidden rounded-md border border-[var(--border-strong)] bg-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring-color)]",
                phoneError && "border-[var(--error)]",
              )}
            >
              <PhoneCountryPicker value={phoneCountryCode} onChange={setPhoneCountryCode} className="h-full w-[92px] shrink-0 rounded-none border-0 border-r border-[var(--border-strong)] bg-transparent focus-visible:ring-0" />
              <input
                className="h-full min-w-0 flex-1 bg-transparent px-3 text-base leading-normal tracking-[-0.02em] text-foreground outline-none placeholder:text-muted-foreground"
                aria-label="Phone number"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                maxLength={24}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                onBlur={() => setPhoneTouched(true)}
                placeholder={phoneCountry(phoneCountryCode)?.example}
                aria-invalid={phoneError ? true : undefined}
                aria-describedby="about-phone-note"
              />
            </div>
            <p id="about-phone-note" aria-live="polite" className="mt-1 text-xs leading-normal text-[var(--error-ink)] empty:hidden">{phoneError}</p>
          </div>
          <div>
            {label("name", solo ? "Business name (optional)" : "Agency name", true)}
            <input className={authControl} aria-label={solo ? "Business name" : "Agency name"} autoComplete="organization" maxLength={160} placeholder={solo ? fullName || "Your own name" : undefined} value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
          <div>
            {label("state", "Primary State")}
            <StatePicker value={primaryState} onChange={setPrimaryState} />
          </div>
          <div>
            {label("sell", "What you sell", true)}
            <MultiPicker label="What you sell" placeholder="Choose products" options={PRODUCT_OPTIONS} value={products} onChange={setProducts} />
          </div>
        </div>

        <div>
          {label("sources", "Where your leads come from")}
          <MultiPicker label="Where your leads come from" placeholder="Choose lead sources" options={LEAD_SOURCE_OPTIONS} value={leadSources} onChange={setLeadSources} />
        </div>

        <fieldset>
          <legend className="contents">{label("volume", "Applications a month")}</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Applications a month">
            {VOLUME_OPTIONS.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={volume === option.value} className={chip(volume === option.value)} onClick={() => setVolume(option.value)}>
                {option.label.replace(/\s*applications\s*\/\s*month$/, "")}
              </button>
            ))}
          </div>
        </fieldset>

        {leadSources.includes("other") && (
          <label className="block">
            <span className={authLabel}>Other lead source</span>
            <input className={authControl} maxLength={120} value={leadSourceOther} onChange={(event) => setLeadSourceOther(event.target.value)} />
          </label>
        )}

        {error && <AuthAlert>{error}</AuthAlert>}
        {/* Back beside Continue, the footer of every step (manager review, 2026-10-28). */}
        <FunnelActions back={back}>
          <Button type="submit" className="h-11 px-4" disabled={submitting}>{submitting ? "Saving…" : "Continue"}</Button>
        </FunnelActions>
      </form>
    </div>
  );
}
