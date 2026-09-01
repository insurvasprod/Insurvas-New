"use client";

import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
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
  type FormTemplate = { template: TemplateRow; tenant_template_id: string; assignment: { definition_version: number } };
  type ScreeningState = { outcome: string; warning: { code: "dnc" | "internal_dq"; message: string } | null; phone: string | null; cached?: boolean };
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const submissionId = useRef(crypto.randomUUID());
  const valuesRef = useRef<Record<string, unknown>>({});
  const dirtyRef = useRef(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState("Loading form…");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [screening, setScreening] = useState<ScreeningState | null>(null);
  const [screeningBusy, setScreeningBusy] = useState(false);
  const [screeningError, setScreeningError] = useState<string | null>(null);
  const [dncAcknowledged, setDncAcknowledged] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<Array<{ leadId: string; matchedOn: string[] }>>([]);
  const [duplicateJustification, setDuplicateJustification] = useState("");
  const [sectionIndex, setSectionIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetch(`/api/partner/forms/${encodeURIComponent(productCode)}`, { cache: "no-store" }), fetch(`/api/partner/forms/${encodeURIComponent(productCode)}/draft`, { cache: "no-store" })])
      .then(async ([formResponse, draftResponse]) => ({ form: await formResponse.json().catch(() => null), draft: await draftResponse.json().catch(() => null), formResponse, draftResponse }))
      .then(({ form, draft, formResponse, draftResponse }) => {
        if (cancelled) return;
        if (!formResponse.ok) { setStatus(form?.error ?? "This product form is unavailable"); return; }
        const nextTemplate = (draftResponse.ok && draft?.template ? draft.template : form.template) as FormTemplate;
        const nextValues = draftResponse.ok && draft?.draft?.payload && typeof draft.draft.payload === "object" ? draft.draft.payload as Record<string, unknown> : {};
        setTemplate(nextTemplate); setValues(nextValues); valuesRef.current = nextValues; setStatus(draftResponse.ok && draft?.draft ? "Draft resumed — screen the phone number to continue" : "Enter a phone number to begin screening");
      }).catch(() => { if (!cancelled) setStatus("Could not load this form"); });
    return () => { cancelled = true; };
  }, [productCode]);

  const persistDraft = useCallback(async (payload: Record<string, unknown>, visibleStatus = true) => {
    if (!template) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/partner/forms/${encodeURIComponent(productCode)}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload }) });
      if (response.ok) { dirtyRef.current = false; if (visibleStatus) setStatus("Draft saved"); }
    } finally { setSaving(false); }
  }, [template, productCode]);

  useEffect(() => {
    if (!template || !dirtyRef.current) return;
    const timer = window.setTimeout(() => { void persistDraft(valuesRef.current); }, 750);
    return () => window.clearTimeout(timer);
  }, [values, template, productCode, persistDraft]);

  useEffect(() => {
    if (!template) return;
    const flush = () => { if (dirtyRef.current) void persistDraft(valuesRef.current, false); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    const onPageHide = () => {
      if (!dirtyRef.current) return;
      void fetch(`/api/partner/forms/${encodeURIComponent(productCode)}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: valuesRef.current }), keepalive: true });
    };
    const interval = window.setInterval(flush, 30000);
    document.addEventListener("visibilitychange", onVisibility); window.addEventListener("pagehide", onPageHide);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("pagehide", onPageHide); };
  }, [template, productCode, persistDraft]);

  const fields = template ? new Map(template.template.fields.map((field) => [field.field_key, field])) : new Map<string, TemplateField>();
  const sections = template?.template.form_definition.sections ?? [];
  const phoneField = template?.template.fields.find((field) => field.type === "phone" && ["phone", "phone_number"].includes(field.field_key)) ?? template?.template.fields.find((field) => field.type === "phone");
  function isEmpty(value: unknown) { return value === undefined || value === null || value === "" || Array.isArray(value) && value.length === 0; }
  function validateField(fieldKey: string, candidate = values) {
    const field = fields.get(fieldKey); const formField = sections.flatMap((section) => section.fields).find((item) => item.field_key === fieldKey); if (!field || !formField || !fieldVisible(formField, candidate)) return null;
    const value = candidate[fieldKey]; if ((field.is_required || formField.is_required) && isEmpty(value)) return `${field.label} is required`; if (isEmpty(value)) return null;
    if (["text", "long_text", "date", "phone", "email", "ssn"].includes(field.type) && typeof value !== "string") return `${field.label} must be text`;
    if (["number", "currency"].includes(field.type) && (typeof value !== "number" || !Number.isFinite(value) || field.type === "currency" && !Number.isInteger(value))) return `${field.label} must be a valid ${field.type === "currency" ? "integer-cent amount" : "number"}`;
    if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(value as string)) return `${field.label} must be a valid email address`;
    if (field.type === "phone" && (value as string).replace(/\D/g, "").length < 10) return `${field.label} must include at least 10 digits`;
    if (field.type === "ssn" && !/^\d{3}-?\d{2}-?\d{4}$/.test(value as string)) return `${field.label} must be a valid SSN`;
    if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value as string)) return `${field.label} must be a valid date`;
    if (field.type === "single_select" && (typeof value !== "string" || !field.options.includes(value))) return `${field.label} must use one of the listed options`;
    if (field.type === "multi_select" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !field.options.includes(item)))) return `${field.label} contains an invalid option`;
    const validation = field.validation ?? {}; const numeric = typeof value === "number" ? value : null;
    if (numeric !== null && ((validation.min !== undefined && numeric < validation.min) || (validation.max !== undefined && numeric > validation.max))) return `${field.label} is outside its allowed range`;
    if (typeof value === "string" && ((validation.min_length !== undefined && value.length < validation.min_length) || (validation.max_length !== undefined && value.length > validation.max_length))) return `${field.label} has an invalid length`;
    if (typeof value === "string" && validation.pattern && !new RegExp(validation.pattern).test(value)) return `${field.label} has an invalid format`;
    return null;
  }
  function validateRequired(candidate = values) { const next: Record<string, string> = {}; for (const section of sections) for (const formField of section.fields) { const field = fields.get(formField.field_key); if (field && fieldVisible(formField, candidate) && (field.is_required || formField.is_required) && isEmpty(candidate[field.field_key])) next[field.field_key] = `${field.label} is required`; } return next; }
  function validateAll() { const next: Record<string, string> = {}; for (const section of sections) for (const formField of section.fields) { const error = validateField(formField.field_key); if (error) next[formField.field_key] = error; } return next; }
  function updateValue(fieldKey: string, value: unknown) {
    const next = { ...valuesRef.current, [fieldKey]: value }; valuesRef.current = next; dirtyRef.current = true; setValues(next); setFieldErrors((current) => { if (!current[fieldKey]) return current; const errors = { ...current }; delete errors[fieldKey]; return errors; }); setSubmitError(null);
    if (phoneField?.field_key === fieldKey && screening) { setScreening(null); setDncAcknowledged(false); setScreeningError("The phone number changed. Screen it again before continuing."); setStatus("Screen the updated phone number to continue"); }
  }
  function blurField(fieldKey: string) { const error = validateField(fieldKey); setFieldErrors((current) => { const next = { ...current }; if (error) next[fieldKey] = error; else delete next[fieldKey]; return next; }); }
  async function screenPhone(event: FormEvent) {
    event.preventDefault(); if (!phoneField) { setScreeningError("This form has no phone field configured"); return; }
    const error = validateField(phoneField.field_key); if (error) { setFieldErrors({ [phoneField.field_key]: error }); setScreeningError("Enter a valid phone number before screening"); return; }
    setScreeningBusy(true); setScreeningError(null); setSubmitError(null);
    try {
      const response = await fetch(`/api/partner/forms/${encodeURIComponent(productCode)}/screen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: valuesRef.current[phoneField.field_key] }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setScreening(null); setScreeningError(body?.error ?? "Screening could not be completed"); setStatus(body?.blocked ? "Submission is blocked until the phone number is cleared" : "Screening failed"); return; }
      setScreening(body); setDncAcknowledged(false); setStatus(body.warning ? "Review the compliance warning to continue" : "Screening passed — complete the form");
    } finally { setScreeningBusy(false); }
  }
  const requiredErrors = validateRequired(values); const canSubmit = Boolean(screening && (!screening.warning || screening.warning.code !== "dnc" || dncAcknowledged) && Object.keys(requiredErrors).length === 0);
  async function submit(event: FormEvent) {
    event.preventDefault(); const errors = validateAll(); if (Object.keys(errors).length) { setFieldErrors(errors); setSubmitError("Complete the highlighted fields before submitting"); setStatus("Complete the highlighted fields"); return; }
    if (!screening) { setSubmitError("Screen the phone number before submitting"); return; }
    setFieldErrors({}); setSubmitError(null); setSaving(true);
    const response = await fetch("/api/partner/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_code: productCode, values: valuesRef.current, submission_id: submissionId.current, screening_warning_acknowledged: dncAcknowledged, duplicate_override_justification: duplicateJustification }) });
    const body = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) {
      const message = body?.error ?? "Could not submit lead";
      if (body?.code === "duplicate_lead") { setDuplicateMatches(body.matches ?? []); setSubmitError("This person may already be in the pipeline. Review the match and add a justification if this is a separate lead."); setStatus("Duplicate review required"); }
      else { setSubmitError(message); setStatus(message); }
      toast.error(message); return;
    }
    setValues({}); valuesRef.current = {}; dirtyRef.current = false; setFieldErrors({}); setDuplicateMatches([]); setDuplicateJustification(""); setScreening(null); setDncAcknowledged(false); submissionId.current = crypto.randomUUID(); setSectionIndex(0); setStatus(body?.replayed ? "Already submitted" : "Submitted"); toast.success(body?.replayed ? "This lead was already submitted" : "Lead submitted to the agent");
  }
  if (!template) return <p className="text-sm text-muted-foreground">{status}</p>;
  if (!phoneField) return <p className="text-sm text-[var(--color-danger)]">This form is missing its configured phone field.</p>;
  if (!screening || screening.warning?.code === "dnc" && !dncAcknowledged) return <form className="max-w-xl space-y-4" onSubmit={screenPhone}><div><p className="font-medium">Phone-first screening</p><p className="text-xs text-muted-foreground">The configured lead form opens only after this number passes compliance screening.</p></div><div className="space-y-1.5"><Label htmlFor={`screen-phone-${productCode}`}>{phoneField.label} *</Label><PartnerField field={phoneField} value={values[phoneField.field_key]} error={fieldErrors[phoneField.field_key]} onChange={(value) => updateValue(phoneField.field_key, value)} />{fieldErrors[phoneField.field_key] && <p className="text-sm text-[var(--color-danger)]" role="alert">{fieldErrors[phoneField.field_key]}</p>}</div>{screeningError && <p className="text-sm text-[var(--color-danger)]" role="alert">{screeningError}</p>}{screening?.warning && <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><p className="font-medium">Compliance warning</p><p>{screening.warning.message}</p><label className="flex items-start gap-2"><input type="checkbox" checked={dncAcknowledged} onChange={(event) => setDncAcknowledged(event.target.checked)} /><span>I acknowledge this DNC warning and want to continue with the customer-initiated submission.</span></label></div>}<Button type="submit" disabled={screeningBusy}>{screeningBusy ? "Screening…" : "Screen phone number"}</Button></form>;
  const activeSection = sections[sectionIndex] ?? sections[0];
  const sectionComplete = (section: typeof activeSection) => Boolean(section && section.fields.filter((item) => { const field = fields.get(item.field_key); return field && fieldVisible(item, values) && (field.is_required || item.is_required); }).every((item) => !validateField(item.field_key, values)));
  return <form className="space-y-5" onSubmit={submit}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{template.template.name}</p><p className="text-xs text-muted-foreground">Form version {template.assignment.definition_version} · Screened {screening.phone ?? "number"} · {status}</p></div>{saving && <span className="text-xs text-muted-foreground">Saving…</span>}</div>{screening.warning && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><p className="font-medium">Compliance warning acknowledged</p><p>{screening.warning.message}</p></div>}<nav aria-label="Form sections" className="flex flex-wrap gap-2">{sections.map((section, index) => <Button key={section.section_key} type="button" variant={index === sectionIndex ? "default" : "outline"} size="sm" onClick={() => setSectionIndex(index)}>{sectionComplete(section) ? "✓ " : ""}{section.label}</Button>)}</nav>{activeSection && <fieldset className="space-y-3 rounded-md border p-3"><legend className="px-1 text-sm font-semibold">{activeSection.label}</legend>{activeSection.fields.map((formField) => { const field = fields.get(formField.field_key); if (!field || !fieldVisible(formField, values)) return null; const error = fieldErrors[field.field_key]; return <div className="space-y-1.5" key={formField.field_key} onBlur={() => blurField(field.field_key)}><Label>{field.label}{(field.is_required || formField.is_required) && <span className="text-destructive"> *</span>}</Label>{field.help_text && <p className="text-xs text-muted-foreground">{field.help_text}</p>}<PartnerField field={field} value={values[field.field_key]} error={error} onChange={(value) => updateValue(field.field_key, value)} />{error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}</div>; })}</fieldset>}{duplicateMatches.length > 0 && <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><p className="font-medium">Possible duplicate lead</p><p>{duplicateMatches.length} existing lead{duplicateMatches.length === 1 ? "" : "s"} matched on {duplicateMatches.flatMap((match) => match.matchedOn).join(", ")}.</p><Label htmlFor={`duplicate-justification-${productCode}`}>Justification to submit as a separate lead</Label><textarea id={`duplicate-justification-${productCode}`} className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2" maxLength={1000} value={duplicateJustification} onChange={(event) => setDuplicateJustification(event.target.value)} /><p className="text-xs text-muted-foreground">At least 10 characters are required and the reason is stored with the lead.</p></div>}{submitError && <p className="text-sm text-[var(--color-danger)]" role="alert">{submitError}</p>}{Object.keys(requiredErrors).length > 0 && <div className="rounded-md border p-3 text-sm"><p className="font-medium">Still needed</p><ul className="list-disc pl-5">{Object.values(requiredErrors).map((error) => <li key={error}>{error}</li>)}</ul></div>}<div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" disabled={sectionIndex === 0} onClick={() => setSectionIndex((index) => Math.max(0, index - 1))}>Previous section</Button><div className="flex gap-2">{sectionIndex < sections.length - 1 && <Button type="button" variant="outline" onClick={() => setSectionIndex((index) => Math.min(sections.length - 1, index + 1))}>Next section</Button>}<Button type="submit" disabled={saving || !canSubmit}>Submit lead</Button></div></div></form>;
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
      <Card><CardHeader><CardTitle>Lead submissions</CardTitle><CardDescription>The form is configured by the agent. Switching products clears the other product&apos;s answers.</CardDescription></CardHeader><CardContent className="space-y-5">{approvedProducts.length > 0 ? <><label className="block max-w-md space-y-1.5"><Label htmlFor="partner-product-picker">Product</Label><select id="partner-product-picker" className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}>{approvedProducts.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}</select></label>{selectedProduct && <PartnerLeadForm key={selectedProduct} productCode={selectedProduct} />}</> : <p className="text-sm text-muted-foreground">No products are approved for this partner yet.</p>}</CardContent></Card>
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
