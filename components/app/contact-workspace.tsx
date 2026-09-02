"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContactRow, ContactWorkspace as Workspace, DuplicateMatch } from "@/lib/contacts/types";

const emptyForm = { first_name: "", last_name: "", dob: "", primary_phone: "", email: "", state: "", address_line1: "", city: "", postal_code: "", custom_fields: {} };
type MergeChoice = "kept" | "merged";
type MergeChoices = Record<string, MergeChoice>;
const mergeFields = [
  ["first_name", "First name"], ["last_name", "Last name"], ["dob", "Date of birth"],
  ["primary_phone", "Primary phone"], ["state", "State"], ["household_id", "Household address"], ["custom_fields", "Custom fields"],
] as const;

function mergeValue(contact: ContactRow | DuplicateMatch, key: string) {
  if (key === "household_id") return [contact.address_line1, contact.city, contact.postal_code].filter(Boolean).join(" · ") || "No address";
  if (key === "custom_fields") return Object.keys(contact.custom_fields).length ? Object.entries(contact.custom_fields).map(([field, value]) => `${field}: ${String(value)}`).join(", ") : "No custom fields";
  return String((contact as unknown as Record<string, unknown>)[key] ?? "—");
}

function reverseChoices(choices: MergeChoices): MergeChoices {
  return Object.fromEntries(Object.entries(choices).map(([key, value]) => [key, value === "kept" ? "merged" : "kept"]));
}

function ContactSummary({ contact }: { contact: ContactRow | DuplicateMatch }) {
  return <div className="space-y-1 text-sm"><p className="font-semibold">{contact.first_name} {contact.last_name}</p><p className="text-muted-foreground">{contact.dob || "No date of birth"} · {contact.primary_phone || "No phone"}</p><p className="text-muted-foreground">{contact.address_line1 || "No address"}{contact.city ? ` · ${contact.city}` : ""}{contact.postal_code ? ` · ${contact.postal_code}` : ""}</p><p className="text-xs text-muted-foreground">Matched on: {"matched_on" in contact ? contact.matched_on.join(", ") || "similarity" : "new contact"}</p></div>;
}

export function ContactWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<{ created: ContactRow; matches: DuplicateMatch[] } | null>(null);
  const [reviewChoices, setReviewChoices] = useState<Record<string, MergeChoices>>({});
  const [field, setField] = useState({ field_key: "", label: "", type: "text" });

  const load = useCallback(async (query = "") => {
    const response = await fetch(`/api/app/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Could not load contacts");
    setWorkspace(body);
  }, []);
  // This effect hydrates the client view from current server state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((error) => toast.error(error.message)); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    const response = await fetch("/api/app/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const body = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) { toast.error(body?.error ?? "Could not create contact"); return; }
    setForm(emptyForm);
    if (body.outcome === "review") { setReview({ created: body.contact, matches: body.duplicates }); setReviewChoices(Object.fromEntries(body.duplicates.map((match: DuplicateMatch) => [match.contact_id, {}]))); }
    else toast.success(body.outcome === "auto_merged" ? "Probable duplicate auto-merged" : "Contact created");
    await load(search);
  }

  async function merge(keptId: string, mergedId: string, field_choices: MergeChoices) {
    const response = await fetch("/api/app/contacts/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kept_id: keptId, merged_id: mergedId, field_choices }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { toast.error(body?.error ?? "Could not merge contacts"); return; }
    setReview(null); setReviewChoices({}); toast.success("Contacts merged; the original records remain recoverable"); await load(search);
  }

  async function undo(mergeId: string) {
    const response = await fetch("/api/app/contacts/merge/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ merge_id: mergeId }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { toast.error(body?.error ?? "Could not undo merge"); return; }
    toast.success("Merge undone; both original contacts are restored"); await load(search);
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const response = await fetch("/api/app/contacts/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: await file.text() }) });
    const body = await response.json().catch(() => null); event.target.value = "";
    if (!response.ok) { toast.error(body?.error ?? "Could not import contacts"); return; }
    toast.success(`${body.imported} contact${body.imported === 1 ? "" : "s"} imported`); await load(search);
  }

  async function saveField(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/app/contacts/field-schema", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...field, options: [], is_required: false, sort_order: workspace?.fieldSchema.length ?? 0 }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { toast.error(body?.error ?? "Could not save field"); return; }
    setField({ field_key: "", label: "", type: "text" }); toast.success("Custom field saved"); await load(search);
  }

  if (!workspace) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading contacts…</CardContent></Card>;
  return <div className="mx-auto min-w-0 max-w-7xl space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-extrabold tracking-tight">Contacts & households</h1><p className="mt-1 text-sm text-muted-foreground">One person per record, grouped by household. Matching is tenant-scoped and household-aware.</p></div><div className="flex flex-wrap gap-2"><label className="inline-flex"><span className="sr-only">Import contacts CSV</span><Input type="file" accept=".csv,text/csv" onChange={(event) => void importFile(event)} /></label><Button asChild variant="outline"><a href="/api/app/contacts/export">Export CSV</a></Button></div></div>
    {review && <Card className="border-amber-500/50"><CardHeader><CardTitle>Review probable duplicate</CardTitle><p className="text-sm text-muted-foreground">Choose which value wins for each field. Nothing is deleted; you can undo the merge.</p></CardHeader><CardContent className="space-y-4">{review.matches.map((match) => { const choices = reviewChoices[match.contact_id] ?? {}; return <div key={match.contact_id} className="space-y-4 rounded-md border p-4"><div className="grid gap-4 lg:grid-cols-2"><div><Badge variant="outline">Existing · {Math.round(match.score * 100)}% {match.confidence}</Badge><ContactSummary contact={match} /></div><div><Badge variant="outline">New record</Badge><ContactSummary contact={review.created} /></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{mergeFields.map(([key, label]) => <label key={key} className="space-y-1 text-sm"><span className="font-medium">{label}</span><select className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" aria-label={`${label} source`} value={choices[key] ?? "kept"} onChange={(event) => setReviewChoices((current) => ({ ...current, [match.contact_id]: { ...choices, [key]: event.target.value as MergeChoice } }))}><option value="kept">Existing: {mergeValue(match, key)}</option><option value="merged">New: {mergeValue(review.created, key)}</option></select></label>)}</div><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void merge(match.contact_id, review.created.id, choices)}>Keep existing</Button><Button type="button" variant="outline" onClick={() => void merge(review.created.id, match.contact_id, reverseChoices(choices))}>Keep new</Button></div></div>; })}</CardContent></Card>}
    <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]"><Card><CardHeader><CardTitle className="text-base">Add contact</CardTitle><p className="text-sm text-muted-foreground">High-confidence matches merge automatically; medium matches wait here for confirmation.</p></CardHeader><CardContent><form onSubmit={create} className="space-y-4">{(["first_name", "last_name", "primary_phone", "email", "address_line1", "city", "postal_code"] as const).map((key) => <div key={key} className="space-y-1.5"><Label htmlFor={`contact-${key}`}>{key.replaceAll("_", " ")}</Label><Input id={`contact-${key}`} type={key === "email" ? "email" : key === "primary_phone" || key === "postal_code" ? "tel" : "text"} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} required={key === "first_name" || key === "last_name"} /></div>)}<div className="space-y-1.5"><Label htmlFor="contact-dob">Date of birth</Label><Input id="contact-dob" type="date" value={form.dob} onChange={(event) => setForm((current) => ({ ...current, dob: event.target.value }))} /></div><div className="space-y-1.5"><Label htmlFor="contact-state">State code</Label><Input id="contact-state" maxLength={2} value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value.toUpperCase() }))} /></div><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Add contact"}</Button></form></CardContent></Card>
      <div className="space-y-6"><Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="text-base">Contact directory <Badge variant="outline">{workspace.contacts.filter((contact) => !contact.merged_into_id).length} active</Badge></CardTitle><div className="flex gap-2"><Input aria-label="Search contacts" placeholder="Search contacts" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(search); }} /><Button variant="outline" type="button" onClick={() => void load(search)}>Search</Button></div></div></CardHeader><CardContent className="space-y-2">{workspace.contacts.filter((contact) => !contact.merged_into_id).map((contact) => <div key={contact.id} className="rounded-md border p-3"><ContactSummary contact={contact} /><div className="mt-2 flex flex-wrap gap-2">{contact.emails.map((email) => <Badge key={email.email} variant="secondary">{email.email}</Badge>)}{Object.entries(contact.custom_fields).map(([key, value]) => <Badge key={key} variant="outline">{key}: {String(value)}</Badge>)}</div></div>)}{!workspace.contacts.some((contact) => !contact.merged_into_id) && <p className="text-sm text-muted-foreground">No contacts yet.</p>}</CardContent></Card>
        <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Custom contact fields</CardTitle></CardHeader><CardContent><form onSubmit={saveField} className="grid gap-3 sm:grid-cols-[1fr_1fr_150px_auto] sm:items-end"><div className="space-y-1.5"><Label htmlFor="field-key">Key</Label><Input id="field-key" placeholder="preferred_language" value={field.field_key} onChange={(event) => setField((current) => ({ ...current, field_key: event.target.value }))} /></div><div className="space-y-1.5"><Label htmlFor="field-label">Label</Label><Input id="field-label" placeholder="Preferred language" value={field.label} onChange={(event) => setField((current) => ({ ...current, label: event.target.value }))} /></div><div className="space-y-1.5"><Label htmlFor="field-type">Type</Label><select id="field-type" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={field.type} onChange={(event) => setField((current) => ({ ...current, type: event.target.value }))}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="single_select">Single select</option><option value="multi_select">Multi select</option><option value="boolean">Boolean</option><option value="currency">Currency (cents)</option><option value="phone">Phone</option></select></div><Button type="submit">Add field</Button></form><div className="mt-4 flex flex-wrap gap-2">{workspace.fieldSchema.filter((item) => item.entity === "contact").map((item) => <Badge key={`${item.entity}-${item.field_key}`} variant="outline">{item.label} · {item.type}</Badge>)}</div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Recent merges</CardTitle></CardHeader><CardContent className="space-y-2">{workspace.merges.map((mergeRow) => <div key={mergeRow.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{mergeRow.reversed_at ? "Undone" : "Merged"} · {new Date(mergeRow.merged_at).toLocaleDateString()}</span>{!mergeRow.reversed_at && <Button type="button" variant="outline" onClick={() => void undo(mergeRow.id)}>Undo merge</Button>}</div>)}{!workspace.merges.length && <p className="text-sm text-muted-foreground">No merges yet.</p>}</CardContent></Card></div>
        </div></div>
  </div>;
}
