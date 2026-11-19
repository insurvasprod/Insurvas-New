"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CreditsDefaults } from "@/components/admin/billing/credits-defaults";
import { GrantDialog, PackDialog, PurchaseDialog } from "@/components/admin/billing/credits-dialogs";
import { CreditsPacks } from "@/components/admin/billing/credits-packs";
import { CreditsPricing } from "@/components/admin/billing/credits-pricing";
import { CreditsUsage, type UsageShow } from "@/components/admin/billing/credits-usage";
import { CreditsUsageSheet } from "@/components/admin/billing/credits-usage-sheet";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { Segmented } from "@/components/ui/view-tabs";
import type { CreditMeterKey, CreditPack, CreditsLimitsData } from "@/lib/creditsLimits/constants";
import { buildMonitorEntries, tenantsOverCount } from "@/lib/creditsLimits/present";
import { notify } from "@/lib/notify";

export type CreditsLens = "usage" | "packs" | "defaults" | "pricing";
const LENSES: readonly CreditsLens[] = ["usage", "packs", "defaults", "pricing"];
const SHOWS: readonly UsageShow[] = ["all", "watch", "over"];

type Dialog =
  | { kind: "pack"; pack: CreditPack | null }
  | { kind: "grant"; prefill: { tenantId?: string; meter?: CreditMeterKey } | null }
  | { kind: "purchase"; pack: CreditPack | null; tenantId?: string };

/**
 * Credits & limits (admin round 1, billing-r2 screen 10): the four parts of the old long scroll as lenses on one card
 * — Usage, Credit packs, Default limits, Meter pricing — chosen by the chips at the start of the card's toolbar and
 * kept in the URL (`?lens=`, `?show=`, the open row `?row=`). Every action is kept: add, edit, archive and restore a
 * pack, grant credits, add a pack to an invoice, edit pricing. A usage row opens a sheet that grants, adds a pack or
 * emails the owner. The title line's two buttons open the grant and pack dialogs (`?dialog=grant|pack`).
 *
 * After any write the page reads again (router.refresh), so the tiles and the status line move with the lists.
 */
export function CreditLimitsPanel({ data, nowIso }: { data: CreditsLimitsData; nowIso: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { packs, pricing, monitor, seats, defaultLimits, tenants, warnPercent } = data;
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const lensParam = params.get("lens");
  const lens: CreditsLens = lensParam && (LENSES as readonly string[]).includes(lensParam) ? (lensParam as CreditsLens) : "usage";
  const showParam = params.get("show");
  const show: UsageShow = showParam && (SHOWS as readonly string[]).includes(showParam) ? (showParam as UsageShow) : "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const rowKey = params.get("row");
  // The title line's buttons ask through the URL; the dialog itself is held here once open.
  const asked = params.get("dialog");

  const entries = useMemo(() => buildMonitorEntries(monitor, seats, warnPercent / 100), [monitor, seats, warnPercent]);
  const overCount = tenantsOverCount(entries);
  const open = rowKey ? entries.find((e) => e.key === rowKey) ?? null : null;
  const refresh = () => startRefresh(() => router.refresh());

  const effective: Dialog | null = dialog ?? (asked === "grant" ? { kind: "grant", prefill: null } : asked === "pack" ? { kind: "pack", pack: null } : null);
  const closeDialog = () => { setDialog(null); if (asked) setParamsInPlace({ dialog: null }); };

  async function setPackActive(pack: CreditPack, isActive: boolean) {
    setBusyPack(pack.id);
    const response = await fetch(`/api/admin/credits-limits/packs/${pack.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: isActive }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) : null;
    setBusyPack(null);
    if (!response || !response.ok) {
      notify.block(result?.error ?? (isActive ? "Could not restore pack" : "Could not archive pack"));
      return;
    }
    notify.done(`${pack.name} ${isActive ? "restored" : "archived"}`);
    refresh();
  }

  const lenses = (
    <Segmented
      label="Part"
      value={lens}
      onChange={(next) => setParamsInPlace({ lens: next === "usage" ? null : next, page: null, row: null })}
      options={[
        { key: "usage", label: "Usage", count: entries.length },
        { key: "packs", label: "Credit packs", count: packs.length },
        { key: "defaults", label: "Default limits" },
        { key: "pricing", label: "Meter pricing", count: pricing.length },
      ]}
    />
  );

  return (
    <>
      {lens === "usage" && (
        <CreditsUsage
          entries={entries}
          warnPercent={warnPercent}
          overCount={overCount}
          show={show}
          onShow={(next) => setParamsInPlace({ show: next === "all" ? null : next, page: null })}
          page={page}
          onPage={(next) => setParamsInPlace({ page: next > 1 ? String(next) : null })}
          lenses={lenses}
          refreshing={refreshing}
          onRefresh={refresh}
          onOpen={(entry) => setParamsInPlace({ row: entry.key })}
          now={now}
        />
      )}
      {lens === "packs" && (
        <CreditsPacks
          packs={packs}
          lenses={lenses}
          busyId={busyPack}
          onEdit={(pack) => setDialog({ kind: "pack", pack })}
          onPurchase={(pack) => setDialog({ kind: "purchase", pack })}
          onSetActive={(pack, active) => void setPackActive(pack, active)}
        />
      )}
      {lens === "defaults" && <CreditsDefaults defaults={defaultLimits} lenses={lenses} />}
      {/* Kept mounted so an unsaved price survives a look at another lens; its LeaveGuard holds a move away. */}
      <div hidden={lens !== "pricing"} className="min-w-0">
        <CreditsPricing pricing={pricing} lenses={lenses} onSaved={refresh} />
      </div>

      {open && lens === "usage" && (
        <CreditsUsageSheet
          key={open.key}
          entry={open}
          now={now}
          canAddPack={packs.some((p) => p.is_active && p.price_cents > 0)}
          onClose={() => setParamsInPlace({ row: null })}
          onGrant={() => setDialog({ kind: "grant", prefill: { tenantId: open.tenantId, meter: open.grantMeter ?? undefined } })}
          onAddPack={() => setDialog({ kind: "purchase", pack: null, tenantId: open.tenantId })}
        />
      )}

      {effective?.kind === "pack" && <PackDialog pack={effective.pack} onClose={closeDialog} onSaved={() => { closeDialog(); refresh(); }} />}
      {effective?.kind === "grant" && <GrantDialog tenants={tenants} prefill={effective.prefill} onClose={closeDialog} onGranted={refresh} />}
      {effective?.kind === "purchase" && (
        <PurchaseDialog
          pack={effective.pack}
          packs={effective.pack ? [] : packs.filter((p) => !open?.grantMeter || p.meter_key === open.grantMeter)}
          tenants={tenants}
          tenantId={effective.tenantId}
          onClose={closeDialog}
          onDone={refresh}
        />
      )}
    </>
  );
}
