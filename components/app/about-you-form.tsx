"use client";

import { useState, type FormEvent } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { useRouter } from "next/navigation";

import { authControl, authLabel } from "@/components/app/auth-card";
import { FunnelHeading, FunnelStepFooter } from "@/components/app/funnel-frame";
import { PhoneCountryPicker } from "@/components/public/phone-country-picker";
import { DEFAULT_PHONE_COUNTRY, checkPhone, phoneCountry } from "@/lib/signup/phone";

export function AboutYouForm({ fullName, phone, audience = null }: { fullName: string; phone: string; audience?: "individual" | "agency" | null }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(fullName === "New user" ? "" : fullName.trim().split(/\s+/)[0] ?? "");
  const [lastName, setLastName] = useState(fullName === "New user" ? "" : fullName.trim().split(/\s+/).slice(1).join(" "));
  const parsedPhone = parsePhoneNumberFromString(phone);
  const [country, setCountry] = useState<string>(parsedPhone?.country ?? DEFAULT_PHONE_COUNTRY);
  const [number, setNumber] = useState(parsedPhone?.formatNational() ?? phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneCheck = checkPhone(country, number);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!phoneCheck.ok) { setError(phoneCheck.error); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/app/onboarding/about-you", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, phone: phoneCheck.e164 }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not save your details. Try again."); return; }
      router.push(body?.redirectTo ?? "/app/onboarding/plan");
      router.refresh();
    } catch {
      setError("Could not reach Insurvas. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-7"><FunnelHeading title={audience === "agency" ? "Your agency workspace" : "Tell us about you"}>{audience === "agency" ? "Add your contact details now. You can fill in agency information after checkout." : "We’ll use these details for your account and payment support."}</FunnelHeading></div>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block"><span className={authLabel}>First name</span><input className={authControl} autoComplete="given-name" maxLength={60} required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
          <label className="block"><span className={authLabel}>Last name</span><input className={authControl} autoComplete="family-name" maxLength={60} required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
        </div>
        <label className="block"><span className={authLabel}>Phone number</span>
          <div className="mt-1.5 flex gap-2">
            <PhoneCountryPicker value={country} onChange={setCountry} className={`${authControl} mt-0 w-[120px] shrink-0`} />
            <input className={`${authControl} mt-0 min-w-0 flex-1`} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={24} required value={number} onChange={(event) => setNumber(event.target.value)} placeholder={phoneCountry(country)?.example} aria-invalid={!phoneCheck.ok || undefined} />
          </div>
          {!phoneCheck.ok && <span className="mt-1.5 block text-xs text-[var(--error-ink)]">{phoneCheck.error}</span>}
        </label>
        {error && <p role="alert" className="rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{error}</p>}
        <FunnelStepFooter backHref="/app/verify-email?confirmed=1" busy={busy} busyLabel="Saving…" disabled={!firstName.trim() || !lastName.trim() || !phoneCheck.ok} />
      </form>
    </div>
  );
}
