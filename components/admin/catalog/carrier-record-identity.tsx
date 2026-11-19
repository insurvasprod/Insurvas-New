"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { notify } from "@/lib/notify";

type Facts = { portalOrigin: string | null; referencePattern: string | null; billingDescriptor: string | null };

/**
 * The carrier record's "Identity & how we find them" (admin round 1, catalog.html screen 8): name and sort through
 * the carrier's own route, the code read-only, and the three portal facts — portal address, what a policy number looks
 * like, the client's bank statement text — through the audited facts route, with the checks the fact-report fix runs.
 * A blank fact clears it.
 */
export function CarrierRecordIdentity({ carrier }: { carrier: { id: string; code: string; name: string; sort_order: number } & Facts }) {
  const router = useRouter();
  const [name, setName] = useState(carrier.name);
  const [sortOrder, setSortOrder] = useState(String(carrier.sort_order));
  const [portal, setPortal] = useState(carrier.portalOrigin ?? "");
  const [pattern, setPattern] = useState(carrier.referencePattern ?? "");
  const [descriptor, setDescriptor] = useState(carrier.billingDescriptor ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);

  const identityChanged = name.trim() !== carrier.name || Number(sortOrder) !== carrier.sort_order;
  const facts: Record<string, string> = {};
  if (portal.trim() !== (carrier.portalOrigin ?? "")) facts.portal_origin = portal.trim();
  if (pattern.trim() !== (carrier.referencePattern ?? "")) facts.reference_pattern = pattern.trim();
  if (descriptor.trim() !== (carrier.billingDescriptor ?? "")) facts.billing_descriptor = descriptor.trim();
  const changed = identityChanged || Object.keys(facts).length > 0;

  function discard() {
    setName(carrier.name); setSortOrder(String(carrier.sort_order)); setPortal(carrier.portalOrigin ?? ""); setPattern(carrier.referencePattern ?? ""); setDescriptor(carrier.billingDescriptor ?? ""); setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save();
  }

  async function save(): Promise<boolean> {
    if (!changed) return true;
    setSaving(true);
    setError(null);
    try {
      if (identityChanged) {
        const response = await fetch(`/api/admin/carriers/${carrier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), sort_order: sortOrder }) });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "The name and sort order were not saved.");
      }
      if (Object.keys(facts).length) {
        const response = await fetch(`/api/admin/carriers/${carrier.id}/facts`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(facts) });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "The portal facts were not saved.");
      }
      notify.done(`${name.trim()} saved`, { detail: Object.keys(facts).length ? "Every agency without its own value now reads the new facts." : undefined });
      router.refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not save.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={scope} onSubmit={submit} className="flex flex-col gap-4" aria-label="Identity and how we find them">
      <LeaveGuard dirty={changed && !saving} scope={scope} onSave={save} onDiscard={discard} what={`${carrier.name}'s details`} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="carrier-name">Name</Label><Input id="carrier-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="carrier-code">Code</Label><Input id="carrier-code" value={carrier.code} disabled readOnly /><p className="m-0 text-xs text-muted-foreground">A stable reference; it never changes.</p></div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="carrier-portal">Portal address</Label>
          <Input id="carrier-portal" inputMode="url" spellCheck={false} value={portal} onChange={(e) => setPortal(e.target.value)} placeholder="https://agents.carrier.com" />
          <p className="m-0 text-xs text-muted-foreground">An https address. Agencies open it from the carrier card; field maps fill forms on it.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="carrier-pattern">Policy number looks like</Label>
          <Input id="carrier-pattern" spellCheck={false} className="font-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="^AM-\d{5,8}$" />
          <p className="m-0 text-xs text-muted-foreground">A pattern. A number that does not match warns and still saves.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="carrier-descriptor">Bank descriptor</Label>
          <Input id="carrier-descriptor" maxLength={60} value={descriptor} onChange={(e) => setDescriptor(e.target.value)} placeholder="AMERICO LIFE COMM" />
          <p className="m-0 text-xs text-muted-foreground">What the client&apos;s bank statement shows; saved in capitals.</p>
        </div>
        <div className="grid gap-1.5"><Label htmlFor="carrier-sort">Sort order</Label><Input id="carrier-sort" type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || !changed}>{saving ? "Saving…" : "Save"}</Button>
        {changed && !saving && <Button type="button" variant="ghost" onClick={discard}>Undo changes</Button>}
        <span className="text-xs text-muted-foreground">Every change is written to the audit log.</span>
      </div>
    </form>
  );
}
