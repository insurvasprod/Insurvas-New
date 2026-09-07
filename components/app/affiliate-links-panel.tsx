"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AffiliateLink = { id: string; slug: string; campaign: string | null; is_active: boolean; click_count: number };

export function AffiliateLinksPanel({ partnerId, readOnly }: { partnerId: string; readOnly: boolean }) {
  const [links, setLinks] = useState<AffiliateLink[]>([]);
  const [slug, setSlug] = useState("");
  const [campaign, setCampaign] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/app/partners/${partnerId}/affiliate-links`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok) setLinks(body.links ?? []); else toast.error(body?.error ?? "Could not load tracked links");
    setLoading(false);
  }, [partnerId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    const response = await fetch(`/api/app/partners/${partnerId}/affiliate-links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, campaign }) });
    const body = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) { toast.error(body?.error ?? "Could not create tracked link"); return; }
    setSlug(""); setCampaign(""); toast.success("Affiliate link created"); await load();
  }
  async function toggle(link: AffiliateLink) {
    const response = await fetch(`/api/app/partners/${partnerId}/affiliate-links/${link.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_active: !link.is_active }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { toast.error(body?.error ?? "Could not update tracked link"); return; }
    toast.success(link.is_active ? "Affiliate link paused" : "Affiliate link activated"); await load();
  }
  async function copyLink(link: AffiliateLink) {
    await navigator.clipboard.writeText(`${window.location.origin}/affiliate/${link.slug}`); toast.success("Tracked link copied");
  }
  return <div className="space-y-3 border-t pt-3"><div><p className="flex items-center gap-2 text-sm font-medium"><Link2 className="size-4" aria-hidden="true" />Tracked affiliate links</p><p className="text-xs text-muted-foreground">Share these links with the affiliate. Visitors use the short referral form and their source stays attached to the lead.</p></div>{!readOnly && <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div className="space-y-1.5"><Label htmlFor={`affiliate-slug-${partnerId}`}>Slug (optional)</Label><Input id={`affiliate-slug-${partnerId}`} value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="ray-spring-campaign" maxLength={80} pattern="[a-z0-9][a-z0-9-]{2,79}" /></div><div className="space-y-1.5"><Label htmlFor={`affiliate-campaign-${partnerId}`}>Campaign (optional)</Label><Input id={`affiliate-campaign-${partnerId}`} value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Spring referrals" maxLength={200} /></div><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create link"}</Button></form>}{loading ? <p className="text-sm text-muted-foreground">Loading tracked links…</p> : links.length === 0 ? <p className="text-sm text-muted-foreground">No tracked links yet.</p> : <div className="space-y-2">{links.map((link) => <div key={link.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"><code className="min-w-0 flex-1 truncate">/affiliate/{link.slug}</code>{link.campaign && <span className="text-muted-foreground">{link.campaign}</span>}<Badge variant={link.is_active ? "default" : "secondary"}>{link.is_active ? "Active" : "Paused"}</Badge><span className="text-xs text-muted-foreground">{link.click_count} clicks</span><Button type="button" variant="ghost" size="sm" onClick={() => void copyLink(link)} aria-label={`Copy ${link.slug} link`}><Copy className="size-4" /></Button>{!readOnly && <Button type="button" variant="outline" size="sm" onClick={() => void toggle(link)}>{link.is_active ? "Pause" : "Activate"}</Button>}</div>)}</div>}</div>;
}
