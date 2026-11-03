"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Bell, Building2, PackageCheck } from "lucide-react";

import { PartnerNotificationPreferences } from "@/components/partner/partner-notification-preferences";
import { NotificationSoundSettings } from "@/components/app/notification-sound-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { SettingsLayout } from "@/components/ui/settings-layout";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { partnerRoleLabel, type PartnerRole } from "@/lib/partnerAuth/roles";

type PartnerStatus = "draft" | "active" | "paused" | "offboarded";
type SettingsProduct = { code: string; name: string; formVersion: number | null; managedBy: string };
type SettingsPayload = {
  partner: { id: string; name: string; contactName: string | null; contactEmail: string | null; timezone: string; status: PartnerStatus };
  user: { id: string; name: string; email: string; lastLoginAt: string | null };
  agency?: { name: string | null };
  products: SettingsProduct[];
};

/**
 * "24 Sep 2026, 2:05 PM" in the reader's own zone. Through lib/format/dates, not Intl directly:
 * the month names there are spelled out so a server and a browser with different ICU data agree.
 * It only ever runs after the settings read lands, which is in the browser.
 */
function formatDate(value: string | null) {
  return value ? dateTime(value, viewerTimeZone(), { year: true, clock: "12h" }) : "Not available";
}

const SECTION_LABELS: Record<string, string> = { account: "Account", notifications: "Notifications", products: "Approved Products" };

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
  const [activeSettings, setActiveSettings] = useState("account");


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

  const detailRow = "grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3 border-b border-border py-3 text-sm last:border-0";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "P";

  return <div className="m-stagger flex w-full flex-1 flex-col gap-6 lg:min-h-[calc(100dvh-var(--top-bar-h,56px)-3.5rem)]">
    <PageHeader
      title="Settings"
      description="Manage your account, notifications, and security."
      hideTitle
      breadcrumbs={[{ label: "Settings" }, { label: SECTION_LABELS[activeSettings] ?? "Account" }]}
    />
    {error && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">{error}<Button type="button" variant="outline" onClick={() => void loadSettings()}>Retry</Button></p>}

    <SettingsLayout
      active={activeSettings}
      onSelect={setActiveSettings}
      searchable
      collapsible
      fitHeight
      groups={[
        { key: "your-account", label: "Your Account", sections: ["account", "notifications"] },
        { key: "agency", label: "Agency", sections: ["products"] },
      ]}
      sections={[
        { key: "account", label: "Account", icon: <Building2 className="size-4" aria-hidden="true" /> },
        { key: "notifications", label: "Notifications", icon: <Bell className="size-4" aria-hidden="true" /> },
        { key: "products", label: "Approved products", icon: <PackageCheck className="size-4" aria-hidden="true" /> },
      ]}
    >
      {activeSettings === "account" && <Card className="h-full min-h-0">
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-base font-semibold text-[var(--accent-ink)]" aria-hidden="true">{initials}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-lg font-semibold tracking-[-0.02em] text-foreground">{name}<InfoTip label="About the partner account">Your organisation as your agency has it on file. Ask them to change anything here.</InfoTip></p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{partnerRoleLabel(role)}<StatusChip tone={status === "active" ? "good" : "neutral"}>{status[0].toUpperCase() + status.slice(1)}</StatusChip></p>
            </div>
          </div>
          <dl className="max-w-3xl border-t border-border">
            <div className={detailRow}><dt className="text-muted-foreground">Contact</dt><dd className="truncate">{contactName}</dd></div>
            <div className={detailRow}><dt className="text-muted-foreground">Work email</dt><dd className="truncate">{contactEmail}</dd></div>
            <div className={detailRow}><dt className="text-muted-foreground">Partner ID</dt><dd className="truncate font-mono text-xs">{id}</dd></div>
            <div className={detailRow}><dt className="text-muted-foreground">Last signed in</dt><dd className="tabular-nums">{formatDate(settings?.user.lastLoginAt ?? null)}</dd></div>
            <div className={detailRow}>
              <dt className="flex items-center gap-1.5 text-muted-foreground">Sessions<InfoTip label="About sessions">Signing out other sessions ends every signed-in browser except this one. Use it if you have signed in somewhere you no longer control.</InfoTip></dt>
              <dd className="flex flex-wrap items-center gap-3"><span>{browserLabel}</span><Button type="button" variant="secondary" size="sm" disabled={signingOut} onClick={() => void signOutOthers()}>{signingOut ? "Signing out…" : "Sign out other sessions"}</Button>{signOutResult && <span className="text-xs text-muted-foreground" role="status">{signOutResult}</span>}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>}
      {activeSettings === "notifications" && <Card className="h-full min-h-0 overflow-y-auto">
        <CardContent className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          <PartnerNotificationPreferences timezone={timezone} canEditTimezone={role === "partner_admin"} onTimezoneSaved={setSavedTimezone} />
          <div className="[&>.portal-notify-sound-settings]:border-t-0 [&>.portal-notify-sound-settings]:pt-0"><NotificationSoundSettings /></div>
        </CardContent>
      </Card>}

      {activeSettings === "products" && <PagedTableCard className="flex h-full min-h-0 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col" total={settings?.products.length ?? 0} noun="products">
        {loading && !settings ? <SectionLoading rows={3} columns={3} />
          : settings?.products.length ? <Table aria-label="Approved partner submission products">
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Form</TableHead><TableHead>Managed by</TableHead></TableRow></TableHeader>
            <PagedBody className="m-seq [&_tr:last-child]:border-0">{settings.products.map((product) => <TableRow key={product.code}><TableCell className="font-medium">{product.name}</TableCell><TableCell>{product.formVersion ? `v${product.formVersion}` : "Not published"}</TableCell><TableCell className="text-muted-foreground">{product.managedBy}</TableCell></TableRow>)}</PagedBody>
          </Table>
          : <div className="flex flex-1 items-center justify-center"><EmptyState title="No approved products yet" hint={`${settings?.agency?.name ?? "Your agent"} controls which products and forms you can submit.`} /></div>}
      </PagedTableCard>}
    </SettingsLayout>
  </div>;
}
