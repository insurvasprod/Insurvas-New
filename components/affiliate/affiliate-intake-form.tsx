"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { US_STATES } from "@/lib/signup/constants";

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
    event.preventDefault(); setSaving(true); setError(null);
    const response = await fetch(`/api/affiliate/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product_code: values.product_interest, values, submission_id: submissionId, screening_warning_acknowledged: Boolean(warning) }) });
    const body = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) {
      if (body?.code === "dnc_acknowledgement_required") { setWarning(body.warning?.message ?? body.error); setStatus("Review the compliance warning before submitting"); }
      setError(body?.error ?? "We could not submit your referral"); toast.error(body?.error ?? "We could not submit your referral"); return;
    }
    setWarning(null); setError(null); setValues({ full_name: "", phone: "", state: "", product_interest: products[0]?.code ?? "", consent: false }); setSubmissionId(crypto.randomUUID()); setStatus("Thanks — your information was sent to the licensed agent."); toast.success("Referral submitted");
  }

  if (error && !link) return <main className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] px-4"><Card className="w-full max-w-lg"><CardHeader><CardTitle>Referral unavailable</CardTitle><CardDescription>{error}</CardDescription></CardHeader></Card></main>;
  return <main className="min-h-screen bg-[var(--color-page-bg)] px-4 py-10 sm:px-6"><Card className="mx-auto w-full max-w-2xl"><CardHeader><p className="text-sm font-semibold text-[var(--color-blue)]">{link?.partner_name ?? "Insurance referral"}</p><CardTitle>Connect with a licensed agent</CardTitle><CardDescription>{link?.campaign ? `Campaign: ${link.campaign}. ` : ""}{status}</CardDescription></CardHeader><CardContent><form className="grid gap-5 sm:grid-cols-2" onSubmit={submit}>
    <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="affiliate-full-name">Full name</Label><Input id="affiliate-full-name" value={values.full_name} onChange={(event) => update("full_name", event.target.value)} maxLength={200} autoComplete="name" required />{error?.includes("Full name") && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}</div>
    <div className="space-y-1.5"><Label htmlFor="affiliate-phone">Phone number</Label><Input id="affiliate-phone" type="tel" value={values.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" required />{error?.includes("Phone") && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}</div>
    <div className="space-y-1.5"><Label htmlFor="affiliate-state">State</Label><select id="affiliate-state" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={values.state} onChange={(event) => update("state", event.target.value)} required><option value="">Choose a state…</option>{US_STATES.map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></div>
    <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="affiliate-product">Product interest</Label><select id="affiliate-product" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={values.product_interest} onChange={(event) => update("product_interest", event.target.value)} required><option value="">Choose a product…</option>{products.map((product) => <option value={product.code} key={product.code}>{product.name}</option>)}</select></div>
    <label className="flex items-start gap-3 text-sm sm:col-span-2"><input className="mt-1 size-4" type="checkbox" checked={values.consent} onChange={(event) => update("consent", event.target.checked)} required /><span>I agree that the licensed agent may contact me about insurance. My information will be sent to the agent connected to this referral link.</span></label>
    {warning && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:col-span-2"><p className="font-medium">Compliance warning</p><p>{warning}</p><p className="mt-2">Submit again to acknowledge this warning and continue.</p></div>}
    {error && !error.includes("Full name") && !error.includes("Phone") && <p className="text-sm text-[var(--color-danger)] sm:col-span-2" role="alert">{error}</p>}
    <Button className="sm:col-span-2 sm:w-fit" type="submit" disabled={saving || products.length === 0}>{saving ? "Submitting…" : "Contact the agent"}</Button>
  </form></CardContent></Card></main>;
}
