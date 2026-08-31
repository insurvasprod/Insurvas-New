"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_SOURCE_OPTIONS, PRODUCT_OPTIONS, US_STATES, VOLUME_OPTIONS } from "@/lib/signup/constants";

export function BusinessProfileForm() {
  const router = useRouter();
  const [products, setProducts] = useState<string[]>([]);
  const [leadSources, setLeadSources] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(value: string, current: string[], setCurrent: (value: string[]) => void) {
    setCurrent(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/app/onboarding/business-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: form.get("businessName"),
        npn: form.get("npn"),
        primaryState: form.get("primaryState"),
        productsSold: products,
        monthlyVolumeRange: form.get("monthlyVolumeRange"),
        leadSources,
        leadSourceOther: form.get("leadSourceOther"),
      }),
    });
    const body = await response.json().catch(() => null);
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Could not save your business profile");
      return;
    }
    router.push(body?.redirectTo ?? "/app/checkout");
    router.refresh();
  }

  return (
    <Card className="bg-white shadow-[0_18px_50px_rgba(0,64,127,0.12)]">
      <CardHeader>
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand-600)]">Email verified</p>
        <CardTitle className="text-3xl font-extrabold tracking-tight">Tell us about your business</CardTitle>
        <p className="text-sm text-[var(--color-text-muted)]">These answers personalize the setup checklist you see after checkout.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-7">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="businessName">Business name</Label>
              <Input id="businessName" name="businessName" minLength={2} maxLength={160} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="npn">National Producer Number (NPN)</Label>
              <Input id="npn" name="npn" inputMode="numeric" pattern="[0-9]{1,10}" maxLength={10} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="primaryState">Primary state</Label>
              <select id="primaryState" name="primaryState" required defaultValue="" className="h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">
                <option value="" disabled>Choose state</option>
                {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Products sold</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PRODUCT_OPTIONS.map((option) => (
                <label key={option.value} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition ${products.includes(option.value) ? "border-[var(--brand-500)] bg-[var(--brand-50)]" : "hover:bg-[var(--color-row-bg)]"}`}>
                  <input type="checkbox" checked={products.includes(option.value)} onChange={() => toggle(option.value, products, setProducts)} />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="monthlyVolumeRange">Monthly application volume</Label>
            <select id="monthlyVolumeRange" name="monthlyVolumeRange" required defaultValue="" className="h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">
              <option value="" disabled>Choose a range</option>
              {VOLUME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">How do you get leads?</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {LEAD_SOURCE_OPTIONS.map((option) => (
                <label key={option.value} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition ${leadSources.includes(option.value) ? "border-[var(--brand-500)] bg-[var(--brand-50)]" : "hover:bg-[var(--color-row-bg)]"}`}>
                  <input type="checkbox" checked={leadSources.includes(option.value)} onChange={() => toggle(option.value, leadSources, setLeadSources)} />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {leadSources.includes("other") && (
            <div className="space-y-1.5">
              <Label htmlFor="leadSourceOther">Other lead source</Label>
              <Input id="leadSourceOther" name="leadSourceOther" maxLength={120} required />
            </div>
          )}

          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={submitting || products.length === 0 || leadSources.length === 0}>
            {submitting ? <LoaderCircle className="animate-spin" /> : <Save />}
            {submitting ? "Saving profile…" : "Save and continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
