"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { CarrierSetupDot, CarrierSetupLegend } from "@/components/admin/catalog/carrier-setup-dot";
import { Switch } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { CarrierRow } from "@/lib/carriers/constants";
import { carrierHref, FACET_INFO, FACETS, isFacet, needsLook, type CarrierSetup, type FacetKey } from "@/lib/carriers/setup";
import {
  CARRIER_IN_USE_CODE,
  USAGE_UNKNOWN_TITLE,
  usageLine,
  usageTitle,
  type CarrierBlockingUsage,
  type CarrierUsageSnapshot,
} from "@/lib/carriers/usage";
import { notify } from "@/lib/notify";
import { recordDate, recordDateTime } from "@/lib/tenants/recordFormat";
import { CarrierDialog } from "./carrier-dialog";
import { CarrierDeactivateDialog } from "./carrier-deactivate-dialog";

type StateFilter = "all" | "active" | "inactive";
type UsageFilter = "any" | "in_use" | "unused";
const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "Active and inactive" },
  { value: "active", label: "Active only" },
  { value: "inactive", label: "Inactive only" },
];
const USAGE_OPTIONS: { value: UsageFilter; label: string }[] = [
  { value: "any", label: "Any usage" },
  { value: "in_use", label: "In use by a tenant" },
  { value: "unused", label: "Not in use" },
];
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/** The short column heads over the dots; the full name is in each head's hover. */
const DOT_HEAD: Record<FacetKey, string> = { facts: "Facts", rules: "Rules", layouts: "Layouts", status: "Status words", fields: "Field maps", guide: "Portal guide", servicing: "Servicing", reports: "Reports" };

/**
 * The carrier library (admin round 1, catalog.html screen 7): one TableCard, one line a row. Code, carrier, the
 * state switch, sort, usage and created as before, plus the carrier's eight set-up facets as dots — each opens that
 * part of the carrier's record — and a "Missing" filter. A row opens the carrier's record page.
 *
 * The switch and the row menu run the same checks as before: switching off a carrier tenants use is refused and
 * opens the in-use dialog (a super admin may override with a reason). The search and the filters live in the URL.
 */
export function CarriersTable({ carriers, usage, setup, canOverride }: {
  carriers: CarrierRow[];
  usage: CarrierUsageSnapshot;
  setup: Record<string, CarrierSetup>;
  /** super_admin: may deactivate a carrier tenants use, with a reason. */
  canOverride: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [editing, setEditing] = useState<CarrierRow | null>(null);
  const [blocked, setBlocked] = useState<{ carrier: CarrierRow; usage: CarrierBlockingUsage | null } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const search = params.get("q") ?? "";
  const stateFilter = pick(params.get("state"), ["all", "active", "inactive"] as const, "all");
  const usageFilter = pick(params.get("usage"), ["any", "in_use", "unused"] as const, "any");
  const missingParam = params.get("missing");
  const missing: FacetKey | "any" | null = missingParam === "any" ? "any" : isFacet(missingParam) ? missingParam : null;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const creating = params.get("new") === "1";
  const pageSize = useFittingPageSize(480, 45);

  const set = (patch: Record<string, string | null>) => setParamsInPlace(patch);
  const filter = (patch: Record<string, string | null>) => set({ ...patch, page: null });
  const refresh = () => startRefresh(() => router.refresh());
  const usageFor = (id: string) => (usage.available ? usage.byCarrier[id] : undefined);

  async function deactivate(carrier: CarrierRow) {
    setPending(carrier.id);
    const response = await fetch(`/api/admin/carriers/${carrier.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPending(null);
    if (response?.status === 409 && body?.code === CARRIER_IN_USE_CODE) {
      setBlocked({ carrier, usage: body.usage ?? null });
      return;
    }
    if (!response?.ok) {
      notify.block(body?.error ?? "Could not deactivate carrier");
      return;
    }
    notify.done(`${carrier.name} deactivated`);
    refresh();
  }

  async function reactivate(carrier: CarrierRow) {
    setPending(carrier.id);
    const response = await fetch(`/api/admin/carriers/${carrier.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPending(null);
    if (!response?.ok) {
      notify.block(body?.error ?? "Could not reactivate carrier");
      return;
    }
    notify.done(`${carrier.name} reactivated`);
    refresh();
  }

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      carriers.filter((carrier) => {
        if (stateFilter === "active" && !carrier.is_active) return false;
        if (stateFilter === "inactive" && carrier.is_active) return false;
        if (usage.available && usageFilter !== "any") {
          const inUse = (usage.byCarrier[carrier.id]?.tenants ?? 0) > 0;
          if (usageFilter === "in_use" ? !inUse : inUse) return false;
        }
        if (missing) {
          const cells = setup[carrier.id];
          if (!cells) return false;
          if (missing === "any" ? !FACETS.some((key) => needsLook(cells[key])) : !needsLook(cells[missing])) return false;
        }
        return !term || carrier.name.toLowerCase().includes(term) || carrier.code.toLowerCase().includes(term);
      }),
    [carriers, stateFilter, usageFilter, usage, term, missing, setup],
  );
  const { current, rows } = paginate(visible, page, pageSize);
  const anyFilter = Boolean(term) || stateFilter !== "all" || usageFilter !== "any" || missing !== null;
  const clearAll = () => filter({ q: null, state: null, usage: null, missing: null });
  const missingCount = (key: FacetKey) => carriers.filter((carrier) => carrier.is_active && setup[carrier.id] && needsLook(setup[carrier.id][key])).length;

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={
          <div className="flex w-full min-w-0 flex-col gap-2">
            <CarrierSetupLegend />
            <Pager page={current} pageSize={pageSize} total={visible.length} noun={visible.length === 1 ? "carrier" : "carriers"} suffix="by sort order, then name" onPage={(next) => set({ page: next > 1 ? String(next) : null })} />
          </div>
        }
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
            <ToolbarSearch value={search} onChange={(value) => filter({ q: value || null })} placeholder="Search carriers" label="Search carriers by name or code" />
            <select aria-label="State" className={toolbarControl} value={stateFilter} onChange={(event) => filter({ state: event.target.value === "all" ? null : event.target.value })}>
              {STATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {usage.available && (
              <select aria-label="Usage" className={toolbarControl} value={usageFilter} onChange={(event) => filter({ usage: event.target.value === "any" ? null : event.target.value })}>
                {USAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
            <select aria-label="Missing" className={toolbarControl} value={missing ?? ""} onChange={(event) => filter({ missing: event.target.value || null })}>
              <option value="">Any set-up</option>
              <option value="any">Missing anything</option>
              {FACETS.map((key) => <option key={key} value={key}>{FACET_INFO[key].missing} ({missingCount(key)})</option>)}
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={clearAll}>Clear</Button>}
          </DataToolbar>
        }
      >
        {carriers.length === 0 ? (
          <EmptyState title="No carriers yet" hint="Add the platform library before agents configure appointments." />
        ) : visible.length === 0 ? (
          <NoMatches noun="carriers" onClear={clearAll} />
        ) : (
          <Table className="min-w-[1500px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[130px]">Code</TableHead>
                <TableHead>Carrier</TableHead>
                {FACETS.map((key) => <TableHead key={key} className="w-[76px] text-center" title={FACET_INFO[key].label}>{DOT_HEAD[key]}</TableHead>)}
                <TableHead className="w-[150px]">State</TableHead>
                <TableHead className="w-[60px] text-right">Sort</TableHead>
                <TableHead className="w-[170px]">Usage</TableHead>
                <TableHead className="w-[110px]">Created</TableHead>
                <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((carrier) => {
                const rowUsage = usageFor(carrier.id);
                const cells = setup[carrier.id];
                const open = () => router.push(carrierHref(carrier.code));
                return (
                  <TableRow key={carrier.id} className="cursor-pointer" onClick={open}>
                    <TableCell><code className="font-mono text-sm">{carrier.code}</code></TableCell>
                    <TableCell className="font-semibold text-foreground">
                      <Link href={carrierHref(carrier.code)} onClick={(event) => event.stopPropagation()} className="block max-w-[16rem] truncate hover:underline">{carrier.name}</Link>
                    </TableCell>
                    {FACETS.map((key) => (
                      <TableCell key={key} className="text-center">
                        {cells ? <CarrierSetupDot cell={cells[key]} label={`${carrier.name} · ${FACET_INFO[key].label}`} href={carrierHref(carrier.code, FACET_INFO[key].tab)} showCount={key === "reports"} /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ))}
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      {/* The switch runs the same checks as the row menu: switching off a carrier in
                          use is refused and opens the in-use dialog, and the switch stays on. */}
                      <span className="inline-flex items-center gap-2">
                        <Switch
                          checked={carrier.is_active}
                          disabled={pending === carrier.id}
                          label={`${carrier.name}: ${carrier.is_active ? "active, switch off" : "inactive, switch on"}`}
                          onChange={(next) => void (next ? reactivate(carrier) : deactivate(carrier))}
                        />
                        <StatusChip tone={carrier.is_active ? "good" : "neutral"}>{carrier.is_active ? "Active" : "Inactive"}</StatusChip>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{carrier.sort_order}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums" title={usage.available ? usageTitle(rowUsage) : USAGE_UNKNOWN_TITLE}>
                      {usage.available ? usageLine(rowUsage) : "Usage unknown"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" title={recordDateTime(carrier.created_at)}>{recordDate(carrier.created_at)}</TableCell>
                    <TableCell className="py-1 text-right" onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" disabled={pending === carrier.id} aria-label={`Actions for ${carrier.name}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={open}>Open the record</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(carrier)}>Edit</DropdownMenuItem>
                          {carrier.is_active ? (
                            <DropdownMenuItem variant="destructive" onSelect={() => void deactivate(carrier)}>Deactivate</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => void reactivate(carrier)}>Reactivate</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      <CarrierDialog key={creating ? "new-open" : "new-closed"} open={creating} onClose={() => set({ new: null })} onSaved={refresh} />
      <CarrierDialog key={editing?.id ?? "edit-none"} open={Boolean(editing)} carrier={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <CarrierDeactivateDialog
        key={blocked?.carrier.id ?? "blocked-none"}
        carrier={blocked?.carrier ?? null}
        usage={blocked?.usage ?? null}
        canOverride={canOverride}
        onClose={() => setBlocked(null)}
        onDeactivated={(name) => {
          setBlocked(null);
          notify.done(`${name} deactivated`);
          refresh();
        }}
      />
    </>
  );
}
