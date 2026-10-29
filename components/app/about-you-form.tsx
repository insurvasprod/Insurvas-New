"use client";

import { useState, type FormEvent } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { useRouter } from "next/navigation";

import { authControl, authLabel } from "@/components/app/auth-card";
import { FunnelHeading, FunnelStepFooter } from "@/components/app/funnel-frame";
import { PhoneField } from "@/components/public/phone-field";
import { DEFAULT_PHONE_COUNTRY, checkPhone } from "@/lib/signup/phone";

export function AboutYouForm({ fullName, phone, audience = null }: { fullName: string; phone: string; audience?: "individual" | "agency" | null }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(fullName === "New user" ? "" : fullName.trim().split(/\s+/)[0] ?? "");
  const [lastName, setLastName] = useState(fullName === "New user" ? "" : fullName.trim().split(/\s+/).slice(1).join(" "));
  const parsedPhone = parsePhoneNumberFromString(phone);
  const [country, setCountry] = useState<string>(parsedPhone?.country ?? DEFAULT_PHONE_COUNTRY);
  const [number, setNumber] = useState(parsedPhone?.formatNational() ?? phone);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneCheck = checkPhone(country, number);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!phoneCheck.ok) { setPhoneTouched(true); setError(phoneCheck.error); return; }
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
          <label className="block"><span className={authLabel}>First Name</span><input className={authControl} autoComplete="given-name" maxLength={60} required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
          <label className="block"><span className={authLabel}>Last Name</span><input className={authControl} autoComplete="family-name" maxLength={60} required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
        </div>
        <div><label htmlFor="about-phone" className={authLabel}>Phone Number</label>
          <PhoneField id="about-phone" country={country} onCountryChange={setCountry} number={number} onNumberChange={setNumber} onBlur={() => setPhoneTouched(true)} invalid={phoneTouched && !phoneCheck.ok} describedBy={phoneTouched && !phoneCheck.ok ? "about-phone-error" : undefined} />
          {phoneTouched && !phoneCheck.ok && <span id="about-phone-error" className="mt-1.5 block text-xs text-[var(--error-ink)]">{phoneCheck.error}</span>}
        </div>
        {error && <p role="alert" className="rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{error}</p>}
        <FunnelStepFooter backHref="/app/verify-email?confirmed=1" busy={busy} busyLabel="Saving…" disabled={!firstName.trim() || !lastName.trim() || !phoneCheck.ok} />
      </form>
    </div>
  );
}
