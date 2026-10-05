"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { US_STATES } from "@/lib/signup/constants";
import { normalizeZip, stateForZip } from "@/lib/geo/zipState";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";

type Product = { code: string; name: string; category: string };
type LinkData = { slug: string; campaign: string | null; partner_name: string };

export function AffiliateIntakeForm({ slug }: { slug: string }) {
  const [link, setLink] = useState<LinkData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [values, setValues] = useState({ full_name: "", phone: "", state: "", product_interest: "", consent: false });
  const [status, setStatus] = useState("Loading referral form…");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  // The consumer gives a ZIP; the state (which the lead needs for calling-window rules) is read from
  // it. Only when the ZIP cannot say — a territory or an unassigned prefix — is the state asked for.
  const [zip, setZip] = useState("");
  const [zipTouched, setZipTouched] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const zipValid = normalizeZip(zip) !== null;
  const zipState = stateForZip(zip);
  const stateName = US_STATES.find(([code]) => code === values.state)?.[1] ?? null;
  const askState = zipValid && !zipState;

  function updateZip(raw: string) {
    setZip(raw);
    const derived = stateForZip(raw);
    setValues((current) => ({ ...current, state: derived ?? (normalizeZip(raw) ? current.state : "") }));
    setError(null);
    setWarning(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/affiliate/${encodeURIComponent(slug)}`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (cancelled) return;
      if (!response.ok) { setError(body?.error ?? "This referral link is not available"); setStatus(""); return; }
      setLink(body.link); setProducts(body.products ?? []); setValues((current) => ({ ...current, product_interest: body.products?.[0]?.code ?? "" })); setStatus("Share your details and the licensed agent will follow up.");
    }).catch(() => { if (!cancelled) { setError("This referral form could not be loaded"); setStatus(""); } });
    return () => { cancelled = true; };
  }, [slug]);

  function update(key: keyof typeof values, value: string | boolean) { setValues((current) => ({ ...current, [key]: value })); setError(null); setWarning(null); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setZipTouched(true);
    if (!zipValid) { setError("Enter a five-digit ZIP code"); return; }
    if (!values.state) { setError("Choose your state"); return; }
    setSaving(true); setError(null);
    const response = await fetch(`/api/affiliate/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product_code: values.product_interest, values, submission_id: submissionId, screening_warning_acknowledged: Boolean(warning) }) });
    const body = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) {
      if (body?.code === "dnc_acknowledgement_required") { setWarning(body.warning?.message ?? body.error); setStatus("Review the compliance warning before submitting"); }
      setError(body?.error ?? "We could not submit your referral"); notify.block(body?.error ?? "We could not submit your referral"); return;
    }
    setWarning(null); setError(null);
    setSubmitted(values.full_name.trim().split(/\s+/)[0] ?? "");
    setValues({ full_name: "", phone: "", state: "", product_interest: products[0]?.code ?? "", consent: false });
    setZip(""); setZipTouched(false);
    setSubmissionId(crypto.randomUUID());
    notify.win("Request sent");
  }

  const shell = (children: ReactNode) => (
    <div className="m-stagger flex min-h-screen flex-col bg-[var(--canvas)]">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-4 sm:px-6 lg:px-16">
        <InsurvasLogo size="public" />
        {link?.partner_name && (
          <span className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
            Referred by <strong className="font-semibold text-foreground">{link.partner_name}</strong>
          </span>
        )}
      </div>
      <main className="flex flex-1 items-center justify-center p-4 sm:p-10">{children}</main>
    </div>
  );

  if (error && !link)
    return shell(
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8">
        <h1 className="text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
          Referral unavailable
        </h1>
        <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">{error}</p>
      </div>,
    );

  if (submitted !== null)
    return shell(
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8" role="status">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--success-surface)] text-[var(--success-ink)]" aria-hidden="true">✓</span>
        <h1 className="mt-4 text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
          {submitted ? `Thanks, ${submitted}` : "Thanks"} — your request is in
        </h1>
        <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
          A licensed agent will call the number you gave, usually the same business day. No quote is binding on that call, and nothing is signed unless you choose to.
        </p>
        <p className="mt-4 text-xs leading-normal text-muted-foreground">
          Changed your mind? You can withdraw your consent at any time — tell the agent when they call.{" "}
          <Link href="/legal/privacy" className="font-semibold text-foreground">Privacy policy</Link>.
        </p>
        <Button type="button" variant="outline" className="mt-6 h-11 w-full border-[var(--border-strong)]" onClick={() => setSubmitted(null)}>
          Send another request
        </Button>
      </div>,
    );

  return shell(
    <div className="flex w-full max-w-[1000px] flex-col items-start gap-8 lg:flex-row">
      <div className="w-full min-w-0 lg:flex-[1.1]">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <h1 className="text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
            Speak to a licensed agent
          </h1>
          <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            {warning
              ? status
              : `${products.length > 1 ? "Four" : "Three"} fields. We never ask for a social security number, a date of birth or a coverage amount on this form.`}
          </p>

          <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="affiliate-full-name">
                Full name <span className="text-[var(--error)]">*</span>
              </Label>
              <Input
                id="affiliate-full-name"
                value={values.full_name}
                onChange={(event) => update("full_name", event.target.value)}
                maxLength={200}
                autoComplete="name"
                required
              />
              {error?.includes("Full name") && (
                <p className="text-sm text-[var(--error-ink)]" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="affiliate-phone">
                Phone number <span className="text-[var(--error)]">*</span>
              </Label>
              <Input
                id="affiliate-phone"
                type="tel"
                value={values.phone}
                onChange={(event) => update("phone", event.target.value)}
                autoComplete="tel"
                required
              />
              {error?.includes("Phone") && (
                <p className="text-sm text-[var(--error-ink)]" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="affiliate-zip">
                ZIP code <span className="text-[var(--error)]">*</span>
              </Label>
              <Input
                id="affiliate-zip"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={10}
                className="max-w-[220px]"
                value={zip}
                onChange={(event) => updateZip(event.target.value)}
                onBlur={() => setZipTouched(true)}
                aria-invalid={(zipTouched && !zipValid) || undefined}
                aria-describedby="affiliate-zip-note"
                required
              />
              <p id="affiliate-zip-note" className="text-xs leading-normal text-muted-foreground" aria-live="polite">
                {zipTouched && !zipValid
                  ? <span className="text-[var(--error-ink)]">Enter a five-digit ZIP code.</span>
                  : zipState && stateName
                    ? <>{stateName} — so the agent calls within your state&rsquo;s permitted hours.</>
                    : askState
                      ? "We could not tell your state from that ZIP. Choose it below."
                      : "Used only to find your state's calling rules."}
              </p>
            </div>

            {askState && (
              <div className="space-y-1.5">
                <Label htmlFor="affiliate-state">
                  State <span className="text-[var(--error)]">*</span>
                </Label>
                <select
                  id="affiliate-state"
                  className="flex h-11 w-full max-w-[280px] rounded-lg border border-[var(--border-strong)] bg-card px-3 text-base"
                  value={values.state}
                  onChange={(event) => update("state", event.target.value)}
                  required
                >
                  <option value="">Choose a state…</option>
                  {US_STATES.map(([code, name]) => (
                    <option value={code} key={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Only asked when the partner offers a choice; with one product it is simply that one. */}
            {products.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="affiliate-product">
                  What you are interested in <span className="text-[var(--error)]">*</span>
                </Label>
                <select
                  id="affiliate-product"
                  className="flex h-11 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-base"
                  value={values.product_interest}
                  onChange={(event) => update("product_interest", event.target.value)}
                  required
                >
                  <option value="">Choose one…</option>
                  {products.map((product) => (
                    <option value={product.code} key={product.code}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-lg border-[1.5px] border-[var(--border-strong)] bg-card p-[18px]">
              <label className="flex gap-3 text-sm leading-relaxed tracking-[-0.02em] text-[var(--body)]">
                <input
                  className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
                  type="checkbox"
                  checked={values.consent}
                  onChange={(event) => update("consent", event.target.checked)}
                  required
                />
                <span>
                  I agree that a licensed agent may call me at the number above, and I agree to receive SMS about my
                  request. I understand consent is not a condition of purchase and that I can withdraw it at any time.
                </span>
              </label>
            </div>

            {warning && (
              <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm text-[var(--body)]">
                <p className="font-semibold text-[var(--warning-ink)]">Compliance warning</p>
                <p className="mt-1.5">{warning}</p>
                <p className="mt-2">Submit again to acknowledge this warning and continue.</p>
              </div>
            )}

            {error && !error.includes("Full name") && !error.includes("Phone") && (
              <p className="text-sm text-[var(--error-ink)]" role="alert">
                {error}
              </p>
            )}

            <Button className="h-13 w-full" type="submit" disabled={saving || products.length === 0}>
              {saving ? "Submitting…" : "Request a call"}
            </Button>

            <p className="text-center text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
              <Link href="/legal/privacy" className="font-semibold text-foreground">
                Privacy policy
              </Link>
              . Your number is used to return your call and nothing else.
            </p>
          </form>
        </div>
      </div>

      <div className="flex w-full min-w-0 flex-col gap-4 lg:flex-[0.9]">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">
            What happens next
          </h2>
          <div className="mt-3">
            {[
              "A licensed agent calls you, usually the same business day.",
              "They confirm what you are looking for. No quote is binding on this call.",
              "If you want cover, they send an application you sign yourself.",
            ].map((step, index) => (
              <div key={step} className="flex gap-3 border-t border-border py-2.5">
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold text-foreground">
                  {index + 1}
                </span>
                <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{step}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5">
          <div className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--info-ink)]">
            Why this page asks so little
          </div>
          <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
            Every extra field on a consumer form costs abandonment and widens the breach surface. Consent is a
            deliberate, unticked act because that record is the TCPA defence.
          </p>
        </div>
      </div>
    </div>,
  );
}
