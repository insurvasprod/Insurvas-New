"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowRight, Check, Info, LockKeyhole, Minus } from "lucide-react";

import { PartnerNotificationPreferences } from "@/components/partner/partner-notification-preferences";
import { NotificationSoundSettings } from "@/components/app/notification-sound-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
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

function statusCopy(status: PartnerStatus) {
  if (status === "active") return "Submissions are open. A draft, paused or offboarded account keeps every read and loses writing, and every disabled control says which.";
  if (status === "paused") return "Existing history remains available while new submissions are paused.";
  if (status === "draft") return "Your agent is still configuring this account.";
  return "This account has been offboarded. Contact your agent if you believe this is unexpected.";
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
  // A partner admin tracks the organization's submissions; a partner user sees only their own.
  const accessItems = useMemo(() => [
    ["Submit leads on the agent-approved form", true],
    [role === "partner_admin" ? "Track your organization’s submissions" : "Track your own submissions", true],
    ["Message your agent", true],
    ["Manage team members", role === "partner_admin"],
  ] as const, [role]);

  return <div className="m-stagger mx-auto w-full max-w-7xl space-y-6">
    <header className="portal-settings-heading border-b border-[var(--portal-line)] pb-5">
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        description="What you control, what your agent controls, and where your data stops."
      />
    </header>
    {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-3 text-sm" role="alert"><span>{error}</span><Button type="button" size="sm" variant="outline" onClick={() => void loadSettings()}>Retry</Button></div>}

    <div className="grid items-stretch gap-4 lg:grid-cols-3">
      <Card><CardHeader><CardTitle>Your access</CardTitle><CardDescription>{partnerRoleLabel(role)}</CardDescription></CardHeader><CardContent><ul className="portal-partner-access-list">{accessItems.map(([label, enabled]) => <li className={enabled ? "" : "is-off"} key={label}><span aria-hidden="true">{enabled ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" strokeWidth={3} />}</span>{label}{!enabled && <span className="sr-only"> (partner admin only)</span>}</li>)}</ul></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center justify-between gap-3">Partner account<Badge variant={status === "active" ? "secondary" : "outline"}>{status[0].toUpperCase() + status.slice(1)}</Badge></CardTitle><CardDescription>Current account state.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{statusCopy(status)}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole className="size-4 text-muted-foreground" aria-hidden="true" />Agent-managed controls</CardTitle><CardDescription>Approved products, form versions and commercial terms belong to {settings?.agency?.name ?? "your agent"}.</CardDescription></CardHeader><CardContent><LinkArrow href="/partner/messages">Contact your agent to request changes</LinkArrow></CardContent></Card>
    </div>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
      <Card><CardHeader><CardTitle>Profile &amp; notifications</CardTitle><CardDescription>The record is owned by your agent; the preferences are yours.</CardDescription></CardHeader><CardContent className="space-y-5">
        <dl className="space-y-2 text-sm"><div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3"><dt className="font-medium text-muted-foreground">Partner</dt><dd className="truncate rounded-md border bg-muted/20 px-3 py-2">{name}</dd></div><div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3"><dt className="font-medium text-muted-foreground">Partner ID</dt><dd className="truncate rounded-md border bg-muted/20 px-3 py-2 font-mono text-xs">{id}</dd></div><div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3"><dt className="font-medium text-muted-foreground">Contact</dt><dd className="truncate rounded-md border bg-muted/20 px-3 py-2">{contactName}</dd></div><div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3"><dt className="font-medium text-muted-foreground">Work email</dt><dd className="truncate rounded-md border bg-muted/20 px-3 py-2">{contactEmail}</dd></div></dl>
        <div className="border-t pt-5"><PartnerNotificationPreferences timezone={timezone} canEditTimezone={role === "partner_admin"} onTimezoneSaved={setSavedTimezone} /></div>
        <div className="border-t pt-5"><NotificationSoundSettings /></div>
      </CardContent></Card>

      <div className="space-y-4">
        <Card><CardHeader className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><CardTitle>Submission configuration</CardTitle><CardDescription>These settings are managed by your agent and determine what you can submit.</CardDescription></div><StatusChip>Read-only</StatusChip></CardHeader><CardContent>{loading && !settings ? <div className="space-y-3" aria-busy="true"><div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="h-8 w-full animate-pulse rounded bg-muted" /><div className="h-8 w-full animate-pulse rounded bg-muted" /></div> : settings?.products.length ? <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[620px] text-sm" aria-label="Approved partner submission products"><thead className="bg-muted/30"><tr className="border-b text-left"><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium">Form</th><th className="px-3 py-2 font-medium">Daily cap</th><th className="px-3 py-2 font-medium">Monthly cap</th><th className="px-3 py-2 font-medium">Managed by</th></tr></thead><tbody>{settings.products.map((product) => <tr className="border-b last:border-0" key={product.code}><td className="px-3 py-3 font-medium">{product.name}</td><td className="px-3 py-3">{product.formVersion ? `v${product.formVersion}` : "Not published"}</td><td className="px-3 py-3 text-muted-foreground">Not exposed</td><td className="px-3 py-3 text-muted-foreground">Not exposed</td><td className="px-3 py-3 text-muted-foreground">{product.managedBy}</td></tr>)}</tbody></table></div> : <div className="rounded-lg border border-dashed p-6 text-center" role="status"><p className="font-semibold">No approved products yet</p><p className="mt-1 text-sm text-muted-foreground">Your agent controls which products and forms this partner can submit.</p></div>}<div className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-[var(--portal-primary)]/20 bg-[var(--portal-primary)]/5 p-4"><Info className="mt-0.5 size-5 shrink-0 text-[var(--portal-primary)]" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="font-medium">Need a configuration change?</p><p className="mt-1 text-sm text-muted-foreground">Send a message to request approved products, form versions, or submission-limit changes.</p></div><Button asChild variant="outline" size="sm"><a href="/partner/messages">Message agent<ArrowRight className="ml-1.5 size-4" aria-hidden="true" /></a></Button></div></CardContent></Card>
        <div className="portal-partner-info-callout"><strong>Data boundary</strong><p>Only <strong>{name}</strong> leads and messages are visible in your partner workspace. Other partners&rsquo; leads and messages are not visible.</p></div>
        <Card><CardHeader><CardTitle>Security &amp; sessions</CardTitle></CardHeader><CardContent className="space-y-4"><dl className="portal-partner-team-figures"><div><dt>This browser</dt><dd>{browserLabel}</dd></div><div><dt>Last signed in</dt><dd>{formatDate(settings?.user.lastLoginAt ?? null)}</dd></div></dl><div><Button type="button" variant="outline" disabled={signingOut} onClick={() => void signOutOthers()}>{signingOut ? "Signing out…" : "Sign out other sessions"}</Button>{signOutResult && <p className="mt-2 text-xs text-muted-foreground" role="status">{signOutResult}</p>}</div></CardContent></Card>
      </div>
    </div>

  </div>;
}
