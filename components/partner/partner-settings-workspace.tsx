"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MessageSquare } from "lucide-react";

import { PartnerNotificationPreferences } from "@/components/partner/partner-notification-preferences";
import { NotificationSoundSettings } from "@/components/app/notification-sound-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { partnerRoleLabel, type PartnerRole } from "@/lib/partnerAuth/roles";

type PartnerStatus = "draft" | "active" | "paused" | "offboarded";
type SettingsProduct = { code: string; name: string; formVersion: number | null; managedBy: string };
type SettingsPayload = {
  partner: { id: string; name: string; contactName: string | null; contactEmail: string | null; timezone: string; status: PartnerStatus };
  user: { id: string; name: string; email: string; lastLoginAt: string | null };
  agency?: { name: string | null };
  products: SettingsProduct[];
};

function formatDate(value: string | null) {
  if (!value) return "Not available";
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return value; }
}

const noSubscription = () => () => {};

/** "Chrome 140 · Windows" — this browser, as the Security card names it. */
function describeBrowser(agent: string) {
  const match = /Edg\/(\d+)/.exec(agent) ? ["Edge", /Edg\/(\d+)/.exec(agent)![1]]
    : /Firefox\/(\d+)/.exec(agent) ? ["Firefox", /Firefox\/(\d+)/.exec(agent)![1]]
    : /Chrome\/(\d+)/.exec(agent) ? ["Chrome", /Chrome\/(\d+)/.exec(agent)![1]]
    : /Version\/(\d+).*Safari/.exec(agent) ? ["Safari", /Version\/(\d+)/.exec(agent)![1]]
    : null;
  const os = /Windows/.test(agent) ? "Windows" : /Mac OS X|Macintosh/.test(agent) ? "macOS" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Linux/.test(agent) ? "Linux" : null;
  const browser = match ? `${match[0]} ${match[1]}` : "This browser";
  return os ? `${browser} · ${os}` : browser;
}

export function PartnerSettingsWorkspace({ role, partnerStatus, partnerId, partnerName, partnerTimezone }: { role: PartnerRole; partnerStatus: PartnerStatus; partnerId?: string; partnerName?: string; partnerTimezone?: string }) {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedTimezone, setSavedTimezone] = useState<string | null>(null);
  // The server has no browser to describe, so it renders "This browser"; the client reads its own.
  const browserLabel = useSyncExternalStore(noSubscription, () => describeBrowser(navigator.userAgent), () => "This browser");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutResult, setSignOutResult] = useState<string | null>(null);


  async function signOutOthers() {
    setSigningOut(true);
    setSignOutResult(null);
    try {
      const response = await fetch("/api/partner/auth/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign_out_others" }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Other sessions could not be signed out.");
      setSignOutResult("Every other session has been signed out. This browser stays signed in.");
    } catch (cause) {
      setSignOutResult(cause instanceof Error ? cause.message : "Other sessions could not be signed out.");
    } finally {
      setSigningOut(false);
    }
  }

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/partner/settings", { cache: "no-store" });
      const body = await response.json().catch(() => null) as (SettingsPayload & { error?: string }) | { error?: string } | null;
      if (!response.ok || !body || !("partner" in body) || !("user" in body)) throw new Error(body && "error" in body ? body.error : "Could not load partner settings");
      setSettings(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load partner settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(kickoff);
  }, [loadSettings]);

  const status = settings?.partner.status ?? partnerStatus;
  const name = settings?.partner.name ?? partnerName ?? "Partner workspace";
  const id = settings?.partner.id ?? partnerId ?? "Not available";
  const timezone = savedTimezone ?? settings?.partner.timezone ?? partnerTimezone ?? "UTC";
  const contactName = settings?.partner.contactName ?? settings?.user.name ?? "Not provided";
  const contactEmail = settings?.partner.contactEmail ?? settings?.user.email ?? "Not provided";

  if (loading && !settings && !error) return <PageLoading strip={false} rows={4} />;

  const detailRow = "grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-2 last:border-0";

  return <div className="m-stagger space-y-6">
    <PageHeader
      title="Settings"
      actions={<Button asChild variant="outline"><a href="/partner/messages"><MessageSquare aria-hidden="true" />Message your agent</a></Button>}
    />
    {error && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">{error}<Button type="button" variant="outline" onClick={() => void loadSettings()}>Retry</Button></p>}

    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center justify-between gap-3">Partner account<Badge variant={status === "active" ? "secondary" : "outline"}>{status[0].toUpperCase() + status.slice(1)}</Badge></CardTitle></CardHeader>
          <CardContent>
            <dl className="text-sm">
              <div className={detailRow}><dt className="text-muted-foreground">Partner</dt><dd className="truncate font-medium">{name}</dd></div>
              <div className={detailRow}><dt className="text-muted-foreground">Partner ID</dt><dd className="truncate font-mono text-xs">{id}</dd></div>
              <div className={detailRow}><dt className="text-muted-foreground">Contact</dt><dd className="truncate">{contactName}</dd></div>
              <div className={detailRow}><dt className="text-muted-foreground">Work email</dt><dd className="truncate">{contactEmail}</dd></div>
              <div className={detailRow}><dt className="text-muted-foreground">Your role</dt><dd>{partnerRoleLabel(role)}</dd></div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Security &amp; sessions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <dl className="text-sm">
              <div className={detailRow}><dt className="text-muted-foreground">This browser</dt><dd>{browserLabel}</dd></div>
              <div className={detailRow}><dt className="text-muted-foreground">Last signed in</dt><dd className="tabular-nums">{formatDate(settings?.user.lastLoginAt ?? null)}</dd></div>
            </dl>
            <div><Button type="button" variant="outline" disabled={signingOut} onClick={() => void signOutOthers()}>{signingOut ? "Signing out…" : "Sign out other sessions"}</Button>{signOutResult && <p className="mt-2 text-xs text-muted-foreground" role="status">{signOutResult}</p>}</div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <PartnerNotificationPreferences timezone={timezone} canEditTimezone={role === "partner_admin"} onTimezoneSaved={setSavedTimezone} />
          <NotificationSoundSettings />
        </CardContent>
      </Card>
    </div>

    <TableCard title="Approved products" action={<StatusChip>Read-only</StatusChip>}>
      {loading && !settings ? <SectionLoading rows={3} columns={5} />
        : settings?.products.length ? <Table aria-label="Approved partner submission products">
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Form</TableHead><TableHead>Daily cap</TableHead><TableHead>Monthly cap</TableHead><TableHead>Managed by</TableHead></TableRow></TableHeader>
          <TableBody>{settings.products.map((product) => <TableRow key={product.code}><TableCell className="font-medium">{product.name}</TableCell><TableCell>{product.formVersion ? `v${product.formVersion}` : "Not published"}</TableCell><TableCell className="text-muted-foreground">Not exposed</TableCell><TableCell className="text-muted-foreground">Not exposed</TableCell><TableCell className="text-muted-foreground">{product.managedBy}</TableCell></TableRow>)}</TableBody>
        </Table>
        : <EmptyState title="No approved products yet" hint={`${settings?.agency?.name ?? "Your agent"} controls which products and forms this partner can submit.`} />}
    </TableCard>
  </div>;
}
