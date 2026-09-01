"use client";

import { useEffect, useState, useRef, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import type { TemplateField, TemplateFormField, TemplateRow } from "@/lib/templates/constants";

type PartnerUser = { id: string; name: string; email: string; role: PartnerRole; status: "active" | "revoked"; accepted_at: string | null; has_password: boolean };
type ApprovedProduct = { code: string; name: string; category: string };

function fieldVisible(field: TemplateFormField, values: Record<string, unknown>) { const condition = field.show_when ?? field.conditional_on; if (!condition) return true; const value = values[condition.field_key]; return Array.isArray(value) ? value.includes(condition.equals) : String(value ?? "") === condition.equals; }
function PartnerField({ field, value, error, onChange }: { field: TemplateField; value: unknown; error?: string; onChange: (value: unknown) => void }) {
  if (field.type === "boolean") return <select aria-label={field.label} aria-invalid={Boolean(error)} className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>;
  if (field.type === "single_select") return <select aria-label={field.label} aria-invalid={Boolean(error)} className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Choose…</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "multi_select") return <div aria-invalid={Boolean(error)} className="flex flex-wrap gap-3 rounded-md border p-2">{field.options.map((option) => <label className="flex items-center gap-1 text-sm" key={option}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => onChange([...(Array.isArray(value) ? value : []).filter((item) => item !== option), ...(event.target.checked ? [option] : [])])} />{option}</label>)}</div>;
  if (field.type === "long_text") return <textarea aria-label={field.label} aria-invalid={Boolean(error)} className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm" value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)} />;
  const inputType = field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text";
  const updateInput = (raw: string) => onChange(raw === "" ? undefined : ["number", "currency"].includes(field.type) ? Number(raw) : raw);
  return <Input aria-label={field.label} aria-invalid={Boolean(error)} type={inputType} inputMode={field.type === "ssn" ? "numeric" : undefined} step={field.type === "currency" ? 1 : field.type === "number" ? "any" : undefined} value={value === undefined ? "" : String(value)} onChange={(event) => updateInput(event.target.value)} onInput={field.type === "date" ? (event) => updateInput(event.currentTarget.value) : undefined} />;
}

function PartnerLeadForm({ productCode }: { productCode: string }) {
  const [template, setTemplate] = useState<{ template: TemplateRow; tenant_template_id: string; assignment: { definition_version: number } } | null>(null);
  const submissionId = useRef(crypto.randomUUID());
  const [values, setValues] = useState<Record<string, unknown>>({}); const [status, setStatus] = useState("Loading form…"); const [saving, setSaving] = useState(false); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}); const [submitError, setSubmitError] = useState<string | null>(null);
  // Product selection replaces the external form and draft state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { let cancelled = false; setTemplate(null); setValues({}); setStatus("Loading form…"); Promise.all([fetch(`/api/partner/forms/${encodeURIComponent(productCode)}`, { cache: "no-store" }), fetch(`/api/partner/forms/${encodeURIComponent(productCode)}/draft`, { cache: "no-store" })]).then(async ([formResponse, draftResponse]) => ({ form: await formResponse.json().catch(() => null), draft: await draftResponse.json().catch(() => null), formResponse, draftResponse })).then(({ form, draft, formResponse, draftResponse }) => { if (cancelled) return; if (!formResponse.ok) { setStatus(form?.error ?? "This product form is unavailable"); return; } setTemplate(form.template); setValues(draftResponse.ok && draft?.draft?.payload ? draft.draft.payload : {}); setStatus(draftResponse.ok && draft?.draft ? "Draft resumed" : "Draft starts automatically while you type"); }).catch(() => { if (!cancelled) setStatus("Could not load this form"); }); return () => { cancelled = true; }; }, [productCode]);
  useEffect(() => { if (!template) return; const timer = window.setInterval(() => { setSaving(true); void fetch(`/api/partner/forms/${encodeURIComponent(productCode)}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: values }) }).then((response) => { if (response.ok) setStatus("Draft saved"); }).finally(() => setSaving(false)); }, 30000); return () => window.clearInterval(timer); }, [productCode, template, values]);
  const fields = template ? new Map(template.template.fields.map((field) => [field.field_key, field])) : new Map<string, TemplateField>();
  function isEmpty(value: unknown) { return value === undefined || value === null || value === "" || Array.isArray(value) && value.length === 0; }
  function validateRequired() { const nextErrors: Record<string, string> = {}; for (const section of template?.template.form_definition.sections ?? []) for (const formField of section.fields) { const field = fields.get(formField.field_key); if (field && fieldVisible(formField, values) && (field.is_required || formField.is_required) && isEmpty(values[field.field_key])) nextErrors[field.field_key] = `${field.label} is required`; } return nextErrors; }
  function updateValue(fieldKey: string, value: unknown) { setValues((current) => ({ ...current, [fieldKey]: value })); setFieldErrors((current) => { if (!current[fieldKey]) return current; const next = { ...current }; delete next[fieldKey]; return next; }); setSubmitError(null); }
  async function submit(event: FormEvent) { event.preventDefault(); const nextErrors = validateRequired(); if (Object.keys(nextErrors).length) { setFieldErrors(nextErrors); setSubmitError("Complete the required fields before submitting"); setStatus("Complete the required fields"); return; } setFieldErrors({}); setSubmitError(null); setSaving(true); const response = await fetch("/api/partner/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_code: productCode, values, submission_id: submissionId.current }) }); const body = await response.json().catch(() => null); setSaving(false); if (!response.ok) { const message = body?.error ?? "Could not submit lead"; setSubmitError(message); setStatus(message); toast.error(message); return; } setValues({}); setFieldErrors({}); submissionId.current = crypto.randomUUID(); setStatus(body?.replayed ? "Already submitted" : "Submitted"); toast.success(body?.replayed ? "This lead was already submitted" : "Lead submitted to the agent"); }
  if (!template) return <p className="text-sm text-muted-foreground">{status}</p>;
  return <form className="space-y-5" onSubmit={submit}><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{template.template.name}</p><p className="text-xs text-muted-foreground">Form version {template.assignment.definition_version} · {status}</p></div>{saving && <span className="text-xs text-muted-foreground">Saving…</span>}</div>{template.template.form_definition.sections.map((section) => <fieldset className="space-y-3 rounded-md border p-3" key={section.section_key}><legend className="px-1 text-sm font-semibold">{section.label}</legend>{section.fields.map((formField) => { const field = fields.get(formField.field_key); if (!field || !fieldVisible(formField, values)) return null; const error = fieldErrors[field.field_key]; return <div className="space-y-1.5" key={formField.field_key}><Label>{field.label}{(field.is_required || formField.is_required) && <span className="text-destructive"> *</span>}</Label>{field.help_text && <p className="text-xs text-muted-foreground">{field.help_text}</p>}<PartnerField field={field} value={values[field.field_key]} error={error} onChange={(value) => updateValue(field.field_key, value)} />{error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}</div>; })}</fieldset>)}{submitError && <p className="text-sm text-[var(--color-danger)]" role="alert">{submitError}</p>}<Button type="submit" disabled={saving}>Submit lead</Button></form>;
}

export function PartnerPortalWorkspace({ role }: { role: PartnerRole }) {
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<PartnerRole>("partner_user");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteFieldError, setInviteFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvedProducts, setApprovedProducts] = useState<ApprovedProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");

  async function loadUsers() {
    const response = await fetch("/api/partner/users");
    const body = await response.json().catch(() => null);
    if (response.ok) setUsers(body?.users ?? []); else setError(body?.error ?? "Could not load users");
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/partner/users"), fetch("/api/partner/products", { cache: "no-store" })])
      .then(async ([userResponse, productResponse]) => ({ userResponse, userBody: await userResponse.json().catch(() => null), productResponse, productBody: await productResponse.json().catch(() => null) }))
      .then(({ userResponse, userBody, productResponse, productBody }) => {
        if (cancelled) return;
        if (userResponse.ok) setUsers(userBody?.users ?? []); else setError(userBody?.error ?? "Could not load users");
        if (productResponse.ok) { setApprovedProducts(productBody?.products ?? []); setSelectedProduct(productBody?.products?.[0]?.code ?? ""); } else setError(productBody?.error ?? "Could not load approved products");
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError("Could not load users"); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  async function invite(event: FormEvent) {
    event.preventDefault(); setError(null); setMessage(null); setInviteFieldError(null);
    if (!name.trim()) { setInviteFieldError("Enter the user's name"); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setInviteFieldError("Enter a valid email address"); return; }
    const response = await fetch("/api/partner/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role: inviteRole }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not send invitation"); return; }
    setName(""); setEmail(""); setMessage(body?.invite?.delivered ? "Invitation sent." : "Invitation created. Copy the link from the administrator if email is not configured."); await loadUsers();
  }

  async function changeStatus(user: PartnerUser) {
    setError(null); setMessage(null);
    const action = user.status === "active" ? "deactivate" : "reactivate";
    const response = await fetch(`/api/partner/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not change user status"); return; }
    setMessage(user.status === "active" ? "User deactivated." : "User reactivated."); await loadUsers();
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-blue)]">Partner workspace</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Lead partnership</h1><p className="mt-1 text-sm text-muted-foreground">Submit and manage partner activity from this portal.</p></div>
      {(message || error) && <div role="status" className={`rounded-lg border p-3 text-sm ${error ? "border-[var(--color-danger)]/40 text-[var(--color-danger)]" : "border-[var(--color-success)]/40 text-[var(--color-success)]"}`}>{error ?? message}</div>}
      <Card><CardHeader><CardTitle>Lead submissions</CardTitle><CardDescription>The form is configured by the agent. Switching products clears the other product&apos;s answers.</CardDescription></CardHeader><CardContent className="space-y-5">{approvedProducts.length > 0 ? <><label className="block max-w-md space-y-1.5"><Label htmlFor="partner-product-picker">Product</Label><select id="partner-product-picker" className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}>{approvedProducts.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}</select></label>{selectedProduct && <PartnerLeadForm productCode={selectedProduct} />}</> : <p className="text-sm text-muted-foreground">No products are approved for this partner yet.</p>}</CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Partner users</CardTitle><CardDescription>{role === "partner_admin" ? "Invite and deactivate people in your partner account." : "People with access to this partner account."}</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {role === "partner_admin" && <form className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end" onSubmit={invite}><div className="space-y-1.5"><Label htmlFor="invite-name">Name</Label><Input id="invite-name" maxLength={120} aria-invalid={Boolean(inviteFieldError && !name.trim())} value={name} onChange={(event) => { setName(event.target.value); setInviteFieldError(null); }} />{inviteFieldError && !name.trim() && <p className="text-sm text-[var(--color-danger)]">{inviteFieldError}</p>}</div><div className="space-y-1.5"><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="text" inputMode="email" maxLength={254} aria-invalid={Boolean(inviteFieldError && !/^\S+@\S+\.\S+$/.test(email.trim()))} value={email} onChange={(event) => { setEmail(event.target.value); setInviteFieldError(null); }} />{inviteFieldError && !/^\S+@\S+\.\S+$/.test(email.trim()) && <p className="text-sm text-[var(--color-danger)]">{inviteFieldError}</p>}</div><div className="space-y-1.5"><Label htmlFor="invite-role">Role</Label><select id="invite-role" className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as PartnerRole)}><option value="partner_user">Partner user</option><option value="partner_admin">Partner admin</option></select></div><Button type="submit">Send invite</Button></form>}
          {loading ? <p className="text-sm text-muted-foreground">Loading users…</p> : users.length === 0 ? <p className="text-sm text-muted-foreground">No users yet.</p> : <div className="divide-y rounded-lg border">{users.map((user) => <div key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{user.name}</p><p className="text-sm text-muted-foreground">{user.email} · {user.role === "partner_admin" ? "Partner admin" : "Partner user"}</p></div><div className="flex items-center gap-3"><span className={`text-xs font-semibold ${user.status === "active" ? "text-[var(--color-success)]" : "text-muted-foreground"}`}>{user.status === "active" ? "Active" : "Deactivated"}</span>{role === "partner_admin" && <Button variant="outline" size="sm" onClick={() => void changeStatus(user)}>{user.status === "active" ? "Deactivate" : "Reactivate"}</Button>}</div></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
