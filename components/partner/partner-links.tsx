"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { copyLink } from "@/components/partner/partner-type-overview";

type PartnerLink = { id: string; slug: string; campaign: string | null; isActive: boolean; clicks: number; referrals: number; createdAt: string };

const n = (value: number) => value.toLocaleString("en-US");

/**
 * Roles board P3 · My links: the affiliate's own tracked links, read-only — the link, its campaign,
 * active or paused, its clicks and the referrals it brought. The agency creates and pauses links
 * (LA-1.8); this page never changes one and never counts a click.
 */
export function PartnerLinks() {
  const [links, setLinks] = useState<PartnerLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/partner/links", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { links?: PartnerLink[]; error?: string } | null;
      if (!response.ok || !Array.isArray(body?.links)) throw new Error(body?.error ?? "Your links could not be loaded");
      setLinks(body.links);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your links could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const kickoff = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(kickoff); }, [load]);

  const active = (links ?? []).filter((link) => link.isActive).length;
  const clicks = (links ?? []).reduce((sum, link) => sum + link.clicks, 0);
  const referrals = (links ?? []).reduce((sum, link) => sum + Math.max(0, link.referrals), 0);

  return (
    <div className="m-stagger flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6">
      <PageHeader title="My links" description="Your tracked links. Anyone who arrives through one is credited to you. Your agency creates and pauses them." hideTitle breadcrumbs={[{ label: "Home" }, { label: "My links" }]} />
      <StatStrip label="Your links">
        <StatTile label="Links active" value={links ? n(active) : "—"} footnote={links ? `of ${n(links.length)}` : undefined} reserveFootnote />
        <StatTile label="Clicks" value={links ? n(clicks) : "—"} footnote="all time" reserveFootnote />
        <StatTile label="Referrals" value={links ? n(referrals) : "—"} href="/partner/pipeline" footnote="through your links" reserveFootnote />
        <StatTile label="Click to referral" value={links && clicks ? `${Math.round((referrals / clicks) * 100)}%` : "—"} reserveFootnote />
      </StatStrip>
      <TableCard className="flex min-h-[18rem] flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col" toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} labelClassName="sr-only" className="px-2.5" />}><span className="text-sm text-muted-foreground">{links ? `${n(links.length)} ${links.length === 1 ? "link" : "links"}` : ""}</span></DataToolbar>}>
        {error ? <div className="flex min-h-48 flex-1 items-center justify-center"><EmptyState title="Not available" hint={error} /></div> : links === null ? <SectionLoading rows={3} columns={5} /> : !links.length ? (
          <div className="flex min-h-48 flex-1 items-center justify-center"><EmptyState title="No links yet" hint="Your agency creates your tracked links. Message them to ask for one." /></div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Link</TableHead><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Referrals</TableHead><TableHead className="w-24 text-right"><span className="sr-only">Copy</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="max-w-[320px] truncate font-mono text-sm">/affiliate/{link.slug}</TableCell>
                  <TableCell className="truncate">{link.campaign ?? <span className="text-muted-foreground">None</span>}</TableCell>
                  <TableCell><StatusChip tone={link.isActive ? "good" : "neutral"}>{link.isActive ? "Active" : "Paused"}</StatusChip></TableCell>
                  <TableCell className="text-right tabular-nums">{n(link.clicks)}</TableCell>
                  <TableCell className="text-right tabular-nums">{link.referrals < 0 ? "—" : n(link.referrals)}</TableCell>
                  <TableCell className="text-right">{link.isActive ? <Button type="button" variant="ghost" size="sm" onClick={() => void copyLink(link.slug)} aria-label={`Copy the link /affiliate/${link.slug}`}><Copy aria-hidden="true" />Copy</Button> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
