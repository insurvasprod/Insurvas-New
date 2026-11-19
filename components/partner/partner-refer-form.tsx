"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CheckBox } from "@/components/ui/check-box";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SelectMenu } from "@/components/ui/select-menu";
import { normalizeZip, stateForZip } from "@/lib/geo/zipState";
import { notify } from "@/lib/notify";
import { PARTNER_WORDS } from "@/lib/partnerAuth/portalAccess";
import type { PartnerType } from "@/lib/partners/constants";
import { productLineLabel } from "@/lib/format/productLine";
import { US_STATES } from "@/lib/signup/constants";

type Product = { code: string; name: string };
type Status = "draft" | "active" | "paused" | "offboarded";

/**
 * LA-1.8's short form inside the portal (roles board P2 "Submit lead", P3 "Refer someone"): name,
 * phone, ZIP (the state is read from it; asked only when the ZIP cannot say), what they are interested
 * in (only when more than one product is approved), and the referred person's consent — the same
 * fields as the public tracked link (components/affiliate/affiliate-intake-form.tsx), posted through
 * the portal's intake (/api/partner/referrals), never through the click-counting public link.
 *
 * Marketing partners keep the full six-section application one click away ("optional", Module 1 §3).
 */
export function PartnerReferForm({ partnerType, partnerStatus }: { partnerType: PartnerType; partnerStatus: Status }) {
  const words = PARTNER_WORDS[partnerType];
  const [products, setProducts] = useState<Product[] | null>(null);
  const [values, setValues] = useState({ full_name: "", phone: "", state: "", product_interest: "", consent: false });
  const [zip, setZip] = useState("");
  const [zipTouched, setZipTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState<{ name: string; leadId: string | null } | null>(null);
  const canSend = partnerStatus === "active";
  const zipValid = normalizeZip(zip) !== null;
  const zipState = stateForZip(zip);
  const askState = zipValid && !zipState;
  const stateName = US_STATES.find(([code]) => code === values.state)?.[1] ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/partner/products", { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) as { products?: Product[]; error?: string } | null }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (!response.ok) { setError(body?.error ?? "Could not load your approved products"); setProducts([]); return; }
        const list = body?.products ?? [];
        setProducts(list);
        setValues((current) => ({ ...current, product_interest: current.product_interest || list[0]?.code || "" }));
      })
      .catch(() => { if (!cancelled) { setError("Could not load your approved products"); setProducts([]); } });
    return () => { cancelled = true; };
  }, []);

  function update(key: keyof typeof values, value: string | boolean) {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
    setWarning(null);
  }

  function updateZip(raw: string) {
    setZip(raw);
    const derived = stateForZip(raw);
    setValues((current) => ({ ...current, state: derived ?? (normalizeZip(raw) ? current.state : "") }));
    setError(null);
    setWarning(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setZipTouched(true);
    if (!zipValid) { setError("Enter a five-digit ZIP code"); return; }
    if (!values.state) { setError("Choose their state"); return; }
    if (!values.consent) { setError("Confirm they agreed to be contacted"); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/partner/referrals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_code: values.product_interest, values, submission_id: submissionId, consent_attested: values.consent, screening_warning_acknowledged: Boolean(warning) }),
      });
      const body = await response.json().catch(() => null) as { error?: string; code?: string; leadId?: string; warning?: { message?: string } } | null;
      if (!response.ok) {
        if (body?.code === "dnc_acknowledgement_required") setWarning(body.warning?.message ?? body.error ?? "Review the compliance warning before sending.");
        setError(body?.error ?? "This could not be sent");
        return;
      }
      setSent({ name: values.full_name.trim().split(/\s+/)[0] ?? "", leadId: body?.leadId ?? null });
      setValues({ full_name: "", phone: "", state: "", product_interest: products?.[0]?.code ?? "", consent: false });
      setZip("");
      setZipTouched(false);
      setWarning(null);
      setSubmissionId(crypto.randomUUID());
      notify.win(`${partnerType === "affiliate" ? "Referral" : "Lead"} sent`);
    } catch {
      setError("Check your connection and send it again.");
    } finally {
      setSaving(false);
    }
  }

  const fullApplication = partnerType === "marketing" ? <Button asChild variant="outline" size="sm"><Link href="/partner/submit-lead"><FileText aria-hidden="true" />Full application</Link></Button> : undefined;
  const header = <PageHeader title={words.submitLabel} description={partnerType === "affiliate" ? "Send the agency someone who asked to hear from a licensed agent." : "A short lead: who, how to reach them, and their consent. The full application is optional."} hideTitle breadcrumbs={[{ label: "Leads" }, { label: words.submitLabel }]} actions={fullApplication} />;

  if (sent) {
    return (
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        {header}
        <section className="m-glass mx-auto flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border p-6" role="status">
          <CheckCircle2 className="size-8 text-[var(--success-ink)]" aria-hidden="true" />
          <h2 className="m-0 text-base font-semibold text-foreground">{sent.name ? `${sent.name} is with the agency` : "Sent to the agency"}</h2>
          <p className="m-0 text-sm text-[var(--body)]">It joins the agency&apos;s queue like any other {words.one}. You can follow what happens to it in {words.pipelineTitle}.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={() => setSent(null)}>{words.submitLabel} again</Button>
            <Button asChild variant="outline"><Link href={sent.leadId ? `/partner/pipeline/${sent.leadId}` : "/partner/pipeline"}>Open it</Link></Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}
      <form className="m-glass mx-auto flex w-full max-w-xl flex-col gap-4 rounded-lg border border-border p-6" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="refer-name">Full name <span className="text-[var(--error)]">*</span></Label>
          <Input id="refer-name" value={values.full_name} onChange={(event) => update("full_name", event.target.value)} maxLength={200} autoComplete="off" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="refer-phone">Phone number <span className="text-[var(--error)]">*</span></Label>
          <Input id="refer-phone" type="tel" value={values.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="off" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="refer-zip">ZIP code <span className="text-[var(--error)]">*</span></Label>
          <Input id="refer-zip" inputMode="numeric" maxLength={10} className="max-w-[220px]" value={zip} onChange={(event) => updateZip(event.target.value)} onBlur={() => setZipTouched(true)} aria-invalid={(zipTouched && !zipValid) || undefined} aria-describedby="refer-zip-note" required />
          <p id="refer-zip-note" className="m-0 text-xs text-muted-foreground" aria-live="polite">
            {zipTouched && !zipValid ? <span className="text-[var(--error-ink)]">Enter a five-digit ZIP code.</span> : zipState && stateName ? `${stateName}, so the agent calls within its permitted hours.` : askState ? "We could not tell the state from that ZIP. Choose it below." : "Used to find the state's calling rules."}
          </p>
        </div>
        {askState && (
          <div className="space-y-1.5">
            <Label>State <span className="text-[var(--error)]">*</span></Label>
            <SelectMenu label="State" value={values.state} onChange={(state) => update("state", state)} searchPlaceholder="Search states" className="w-full max-w-[280px]" panelAlign="start" options={[{ value: "", label: "Choose a state" }, ...US_STATES.map(([code, name]) => ({ value: code, label: name }))]} />
          </div>
        )}
        {/* Asked only when there is a choice; with one approved product it is that one. */}
        {(products?.length ?? 0) > 1 && (
          <div className="space-y-1.5">
            <Label>What they are interested in <span className="text-[var(--error)]">*</span></Label>
            <SelectMenu label="Product interest" value={values.product_interest} onChange={(code) => update("product_interest", code)} searchPlaceholder="Search products" className="w-full" panelAlign="start" options={(products ?? []).map((product) => ({ value: product.code, label: productLineLabel(product.code) || product.name }))} />
          </div>
        )}
        <label className="flex gap-3 rounded-lg border border-[var(--border-strong)] p-4 text-sm leading-relaxed text-[var(--body)]">
          <CheckBox className="mt-0.5" checked={values.consent} onChange={(event) => update("consent", event.target.checked)} required />
          <span>They agreed that a licensed agent may call and text them at this number about insurance. Consent is not a condition of purchase and they can withdraw it at any time.</span>
        </label>
        {warning && (
          <p className="m-0 text-sm text-[var(--warning-ink)]" role="status"><span className="font-semibold">Compliance warning.</span> {warning} Send again to acknowledge it.</p>
        )}
        {error && <p className="m-0 text-sm text-[var(--error-ink)]" role="alert">{error}</p>}
        <Button type="submit" disabled={saving || !canSend || !products?.length}>{saving ? "Sending…" : `Send to the agency`}</Button>
        {products !== null && !products.length && <p className="m-0 text-sm text-muted-foreground">No products are approved for you yet. <Link href="/partner/messages" className="font-semibold text-foreground">Message your agent</Link>.</p>}
      </form>
    </div>
  );
}
