"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { MoreHorizontal } from "lucide-react";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { Field, Pill, SettingsMeter, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CREDIT_METER_KEYS,
  CREDIT_METER_LABELS,
  type CreditMeterKey,
  type CreditPack,
  type CreditsLimitsData,
  type DefaultLimitRow,
  type MeterPricing,
} from "@/lib/creditsLimits/constants";
import { buildMonitorEntries, tenantsOverCount, tenantsOverLabel, type LimitState, type MonitorEntry } from "@/lib/creditsLimits/present";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const count = (value: number) => value.toLocaleString("en-US");

const FIGURE_TONE: Record<LimitState, string> = {
  over: "text-[var(--error-ink)]",
  near: "text-[var(--warning-ink)]",
  ok: "text-[var(--success-ink)]",
};
const METER_TONE: Record<LimitState, "error" | "warning" | "success"> = { over: "error", near: "warning", ok: "success" };

/** Compact inputs for the pricing table's cells; the dialogs use the boards' 44px `control`. */
const cellInput =
  "ml-auto box-border block h-8 w-28 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-right text-[14px] leading-[1.43] tabular-nums text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

type PackForm = { name: string; meter_key: CreditMeterKey; quantity: string; price_cents: string };
const emptyPack: PackForm = { name: "", meter_key: "tcpa_checks", quantity: "5000", price_cents: "4500" };

type GrantForm = { tenant_id: string; meter_key: CreditMeterKey; quantity: string; reason: string };

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined;
}

export function CreditLimitsPanel({ initial }: { initial: CreditsLimitsData }) {
  const [data, setData] = useState(initial);
  const { packs, pricing, monitor, seats, defaultLimits, tenants, warnPercent } = data;
  const warn = warnPercent / 100;

  const [overOnly, setOverOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Pack create / edit dialog.
  const [packDialog, setPackDialog] = useState<{ pack: CreditPack | null } | null>(null);
  const [packForm, setPackForm] = useState<PackForm>(emptyPack);
  const [packError, setPackError] = useState<string | null>(null);

  // Grant dialog. The request id is the grant's idempotency key: kept across retries of one grant, so
  // a retry after a failure can never grant twice (the route answers with the committed grant).
  const [grantOpen, setGrantOpen] = useState(false);
  const [grant, setGrant] = useState<GrantForm>({ tenant_id: tenants[0]?.id ?? "", meter_key: "tcpa_checks", quantity: "1000", reason: "" });
  const [grantRequestId, setGrantRequestId] = useState<string | undefined>(undefined);
  const [grantError, setGrantError] = useState<string | null>(null);

  // Purchase (add a pack to an invoice) dialog.
  const [purchasePack, setPurchasePack] = useState<CreditPack | null>(null);
  const [purchase, setPurchase] = useState({ tenant_id: tenants[0]?.id ?? "", quantity: "1", reason: "" });
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // Unsaved pricing edits, keyed by meter. Empty means nothing is dirty and the save bar is gone.
  const [draft, setDraft] = useState<Record<string, { sell: string; included: string }>>({});

  const entries = useMemo(() => buildMonitorEntries(monitor, seats, warn), [monitor, seats, warn]);
  const visible = useMemo(() => (overOnly ? entries.filter((entry) => entry.state !== "ok") : entries), [entries, overOnly]);
  const overCount = tenantsOverCount(entries);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/credits-limits");
    if (!response.ok) {
      notify.block("Could not refresh credits and limits");
      return;
    }
    setData((await response.json()) as CreditsLimitsData);
  }, []);

  /* ── packs ─────────────────────────────────────────────────────────── */

  function openPackDialog(pack: CreditPack | null) {
    setPackError(null);
    setPackForm(pack ? { name: pack.name, meter_key: pack.meter_key, quantity: String(pack.quantity), price_cents: String(pack.price_cents) } : emptyPack);
    setPackDialog({ pack });
  }

  async function submitPack(event: FormEvent) {
    event.preventDefault();
    const editing = packDialog?.pack ?? null;
    setBusy("pack");
    setPackError(null);
    const body = { ...packForm, quantity: Number(packForm.quantity), price_cents: Number(packForm.price_cents) };
    const response = await fetch(editing ? `/api/admin/credits-limits/packs/${editing.id}` : "/api/admin/credits-limits", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok) {
      setPackError(result?.error ?? "Could not save credit pack");
      return;
    }
    notify.done(editing ? "Credit pack updated" : "Credit pack created");
    setPackDialog(null);
    void refresh();
  }

  async function setPackActive(pack: CreditPack, isActive: boolean) {
    setBusy(pack.id);
    const response = await fetch(`/api/admin/credits-limits/packs/${pack.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: isActive }),
    });
    const result = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok) {
      notify.block(result?.error ?? (isActive ? "Could not restore pack" : "Could not archive pack"));
      return;
    }
    notify.done(`${pack.name} ${isActive ? "restored" : "archived"}`);
    void refresh();
  }

  /* ── grants ────────────────────────────────────────────────────────── */

  function openGrant(prefill?: { tenantId: string; meter: CreditMeterKey }) {
    setGrantError(null);
    setGrant((current) => ({
      ...current,
      tenant_id: prefill?.tenantId ?? current.tenant_id ?? tenants[0]?.id ?? "",
      meter_key: prefill?.meter ?? current.meter_key,
      reason: "",
    }));
    setGrantRequestId(newRequestId());
    setGrantOpen(true);
  }

  function editGrant(patch: Partial<GrantForm>) {
    // Changing what is granted makes it a different request; retrying the same one keeps its id.
    setGrant((current) => ({ ...current, ...patch }));
    setGrantRequestId(newRequestId());
  }

  async function submitGrant(event: FormEvent) {
    event.preventDefault();
    setBusy("grant");
    setGrantError(null);
    const response = await fetch("/api/admin/credits-limits/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...grant, quantity: Number(grant.quantity), request_id: grantRequestId }),
    });
    const result = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok) {
      // The request id is kept, so pressing Grant again retries THIS grant and cannot make a second.
      setGrantError(result?.error ?? "Could not grant credits");
      if (result?.granted) void refresh();
      return;
    }
    notify.done(result?.replayed ? "These credits were already granted" : "Credits granted");
    if (result?.warning) notify.warn(result.warning);
    setGrantOpen(false);
    setGrantRequestId(undefined);
    void refresh();
  }

  /* ── purchases ─────────────────────────────────────────────────────── */

  function openPurchase(pack: CreditPack) {
    setPurchaseError(null);
    setPurchase((current) => ({ ...current, quantity: "1", reason: "" }));
    setPurchasePack(pack);
  }

  async function submitPurchase(event: FormEvent) {
    event.preventDefault();
    if (!purchasePack) return;
    setBusy("purchase");
    setPurchaseError(null);
    const response = await fetch(`/api/admin/credits-limits/packs/${purchasePack.id}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...purchase, quantity: Number(purchase.quantity) }),
    });
    const result = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok) {
      if (result?.purchased) {
        // Committed: close the dialog so it cannot be submitted a second time, and say so loudly.
        notify.fail(result.error);
        setPurchasePack(null);
        void refresh();
        return;
      }
      setPurchaseError(result?.error ?? "Could not add pack to invoice");
      return;
    }
    notify.done(`Added ${purchasePack.name} to invoice ${result.number}; the credits are granted`);
    setPurchasePack(null);
    void refresh();
  }

  /* ── pricing ───────────────────────────────────────────────────────── */

  const draftFor = (row: MeterPricing) =>
    draft[row.meter_key] ?? { sell: String(row.sell_cents), included: row.default_included === null ? "" : String(row.default_included) };
  const isDirty = (row: MeterPricing) => {
    const edit = draft[row.meter_key];
    if (!edit) return false;
    const included = row.default_included === null ? "" : String(row.default_included);
    return edit.sell !== String(row.sell_cents) || edit.included !== included;
  };
  const editRow = (row: MeterPricing, patch: Partial<{ sell: string; included: string }>) =>
    setDraft((d) => ({ ...d, [row.meter_key]: { ...draftFor(row), ...patch } }));
  const dirtyRows = pricing.filter((row) => isDirty(row));

  /**
   * Saves every edited row in one action.
   *
   * There used to be a Save button on each row — five stacked buttons on first load, which made a
   * read-only screen look like a form that had already gone wrong. Edits collect in `draft` and one
   * bar commits them.
   */
  async function savePricing() {
    if (dirtyRows.length === 0) return;
    setBusy("pricing");
    const failures: string[] = [];
    for (const row of dirtyRows) {
      const edit = draft[row.meter_key];
      const includedRaw = (edit?.included ?? "").trim();
      const response = await fetch("/api/admin/credits-limits/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meter_key: row.meter_key,
          sell_cents: Number(edit?.sell ?? row.sell_cents),
          default_included: includedRaw === "" ? null : Number(includedRaw),
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        failures.push(`${CREDIT_METER_LABELS[row.meter_key]}: ${result?.error ?? "could not save"}`);
      }
    }
    setBusy(null);
    if (failures.length > 0) {
      // The draft is kept on a partial failure — discarding what somebody typed because one of five
      // rows was refused is how people lose work.
      notify.fail(failures.join(" · "));
      return;
    }
    notify.done(dirtyRows.length === 1 ? "Pricing saved" : `${dirtyRows.length} meters saved`);
    setDraft({});
    void refresh();
  }

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Credits & limits"
        actions={
          <Button type="button" onClick={() => openPackDialog(null)}>
            Add a credit pack
          </Button>
        }
      />

      {/* Usage monitor */}
      <TableCard
        className="min-w-0"
        title="Usage monitor"
        toolbar={
          <DataToolbar
            actions={
              <RefreshButton
                refreshing={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void refresh().finally(() => setRefreshing(false));
                }}
              />
            }
          >
            <select
              aria-label="Show limits"
              value={overOnly ? "over" : "all"}
              onChange={(event) => {
                setOverOnly(event.target.value === "over");
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="all">All limits</option>
              <option value="over">Over {warnPercent}%</option>
            </select>
            <Pill tone={overCount > 0 ? "error" : "success"} dot>
              {tenantsOverLabel(overCount)}
            </Pill>
          </DataToolbar>
        }
      >

        {pageRows.length === 0 ? (
          <p className="m-0 px-4 py-6 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
            {overOnly
              ? `No tenant is at or above ${warnPercent}% of a limit.`
              : "No tenant has a finite limit to watch. Unlimited meters are not listed."}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {pageRows.map((entry) => (
              <MonitorRow key={entry.key} entry={entry} onGrant={openGrant} />
            ))}
          </ul>
        )}

        {visible.length > PAGE_SIZE && (
          <BoardTableFooter
            page={currentPage}
            pageSize={PAGE_SIZE}
            total={visible.length}
            itemLabel={visible.length === 1 ? "limit" : "limits"}
            order="nearest the limit first"
            onPageChange={setPage}
          />
        )}
      </TableCard>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_560px]">
        {/* Credit packs */}
        <TableCard className="min-w-0" title="Credit packs">
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Pack</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Meter</th>
                <th scope="col" className={cn(st.th, "w-[100px]")}>Quantity</th>
                <th scope="col" className={cn(st.th, "w-[100px]")}>Price</th>
                <th scope="col" className={cn(st.th, "w-12")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {packs.length === 0 && (
                <tr>
                  <td colSpan={5} className={cn(st.td, "text-[var(--muted)]")}>No credit packs yet. Add one to sell a top-up.</td>
                </tr>
              )}
              {packs.map((pack) => (
                <tr key={pack.id} className={cn("m-row", !pack.is_active && "text-[var(--muted)]")}>
                  <td className={st.td}>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {pack.name}
                      {!pack.is_active && <Pill>Archived</Pill>}
                    </span>
                  </td>
                  <td className={st.td}>{CREDIT_METER_LABELS[pack.meter_key] ?? pack.meter_key}</td>
                  <td className={cn(st.td, "tabular-nums")}>{count(pack.quantity)}</td>
                  <td className={cn(st.td, "tabular-nums")}>{money(pack.price_cents)}</td>
                  <td className={cn(st.td, "py-1 text-right")}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${pack.name}`} disabled={busy === pack.id}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onSelect={() => openPackDialog(pack)}>Edit pack</DropdownMenuItem>
                        {pack.is_active && (
                          <DropdownMenuItem disabled={pack.price_cents <= 0} onSelect={() => openPurchase(pack)}>
                            {pack.price_cents <= 0 ? "Add to invoice (free packs need none)" : "Add to an invoice"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {pack.is_active ? (
                          <DropdownMenuItem onSelect={() => void setPackActive(pack, false)}>Archive</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => void setPackActive(pack, true)}>Restore</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>

        {/* Default limits */}
        <TableCard className="min-w-0" title="Default limits">
          {defaultLimits.plans.length === 0 ? (
            <p className="m-0 px-4 py-6 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No current plans.</p>
          ) : (
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Meter</th>
                  {defaultLimits.plans.map((plan) => (
                    <th key={plan.id} scope="col" title={`${plan.code} v${plan.version}`} className={cn(st.th, "w-[110px]")}>
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="m-seq">
                {defaultLimits.rows.map((row) => (
                  <DefaultLimitsRow key={row.key} row={row} planIds={defaultLimits.plans.map((plan) => plan.id)} />
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </div>

      {/* Meter pricing — kept from the previous screen, below the board's blocks. */}
      <TableCard className="min-w-0" title="Meter pricing">
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Meter</th>
              <th scope="col" className={cn(st.th, "text-right")}>Vendor cost</th>
              <th scope="col" className={cn(st.th, "text-right")}>Sell price (cents)</th>
              <th scope="col" className={cn(st.th, "text-right")}>Margin</th>
              <th scope="col" className={cn(st.th, "text-right")}>Platform default</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {pricing.map((row) => {
              const edit = draftFor(row);
              const sell = Number(edit.sell) || 0;
              // Three states, not two. An unpriced meter is UNSET, not wrong — showing it in red meant
              // the screen opened with every row in an error state, which teaches people to ignore red.
              // Only a real price at or below cost is a warning.
              const unpriced = sell === 0;
              const belowCost = !unpriced && sell <= row.cost_cents;
              const margin = row.cost_cents > 0 && !unpriced ? Math.round(((sell - row.cost_cents) / row.cost_cents) * 100) : null;
              return (
                <tr key={row.meter_key} className={cn("m-row", belowCost && "bg-[var(--warning-surface)]")}>
                  <td className={st.td}>
                    <span className={st.strong}>{CREDIT_METER_LABELS[row.meter_key]}</span>
                    <span className={cn(st.sub, "font-mono")}>{row.meter_key}</span>
                  </td>
                  <td className={cn(st.td, st.num)}>
                    {money(row.cost_cents)}
                    <span className={st.sub}>{row.cost_source === "compliance_vendor" ? "From vendor" : "Set here"}</span>
                  </td>
                  <td className={st.td}>
                    <input
                      type="number"
                      min="0"
                      value={edit.sell}
                      aria-label={`${CREDIT_METER_LABELS[row.meter_key]} sell price in cents`}
                      aria-invalid={belowCost}
                      onChange={(event) => editRow(row, { sell: event.target.value })}
                      className={cn(cellInput, belowCost && "border-[var(--warning)]")}
                    />
                  </td>
                  <td className={cn(st.td, "text-right")}>
                    {unpriced ? (
                      <span className="text-[var(--muted)]">Not priced</span>
                    ) : (
                      <>
                        <span className={cn("font-semibold tabular-nums", belowCost ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]")}>
                          {margin === null ? "—" : `${margin > 0 ? "+" : ""}${margin}%`}
                        </span>
                        {belowCost && <span className={cn(st.sub, "text-[var(--warning-ink)]")}>At or below cost</span>}
                      </>
                    )}
                  </td>
                  <td className={st.td}>
                    <input
                      type="number"
                      min="0"
                      value={edit.included}
                      placeholder="Unlimited"
                      aria-label={`${CREDIT_METER_LABELS[row.meter_key]} platform default allowance`}
                      onChange={(event) => editRow(row, { included: event.target.value })}
                      className={cellInput}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>

      {/* Pack create / edit */}
      <Dialog open={packDialog !== null} onOpenChange={(open) => !open && setPackDialog(null)}>
        <DialogContent>
          <form onSubmit={submitPack} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{packDialog?.pack ? `Edit ${packDialog.pack.name}` : "Add a credit pack"}</DialogTitle>
              <DialogDescription>
                A reusable pack. Adding it to a tenant&apos;s invoice bills them and grants its credits at once.
              </DialogDescription>
            </DialogHeader>
            <Field label="Name" htmlFor="pack-name" required>
              <input id="pack-name" required maxLength={160} value={packForm.name} onChange={(event) => setPackForm({ ...packForm, name: event.target.value })} placeholder="5,000 TCPA checks" className={control} />
            </Field>
            <Field label="Meter" htmlFor="pack-meter">
              <select id="pack-meter" value={packForm.meter_key} onChange={(event) => setPackForm({ ...packForm, meter_key: event.target.value as CreditMeterKey })} className={control}>
                {CREDIT_METER_KEYS.map((key) => (
                  <option key={key} value={key}>{CREDIT_METER_LABELS[key]}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quantity" htmlFor="pack-quantity" required>
                <input id="pack-quantity" required type="number" min="1" value={packForm.quantity} onChange={(event) => setPackForm({ ...packForm, quantity: event.target.value })} className={control} />
              </Field>
              <Field label="Price (cents)" htmlFor="pack-price" required hint={Number.isFinite(Number(packForm.price_cents)) ? money(Number(packForm.price_cents)) : undefined}>
                <input id="pack-price" required type="number" min="0" value={packForm.price_cents} onChange={(event) => setPackForm({ ...packForm, price_cents: event.target.value })} className={control} />
              </Field>
            </div>
            {packError && <p role="alert" className="m-0 text-[14px] leading-[1.5] text-[var(--error-ink)]">{packError}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPackDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={busy === "pack"}>
                {busy === "pack" ? "Saving…" : packDialog?.pack ? "Save pack" : "Create pack"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Grant credits */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <form onSubmit={submitGrant} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Grant credits</DialogTitle>
              <DialogDescription>
                Credits add to this tenant&apos;s allowance immediately and count for the current billing period only: they end
                when the period rolls over. A reason is required and recorded in the audit log.
              </DialogDescription>
            </DialogHeader>
            <Field label="Tenant" htmlFor="grant-tenant" required>
              <select id="grant-tenant" required value={grant.tenant_id} onChange={(event) => editGrant({ tenant_id: event.target.value })} className={control}>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Meter" htmlFor="grant-meter">
                <select id="grant-meter" value={grant.meter_key} onChange={(event) => editGrant({ meter_key: event.target.value as CreditMeterKey })} className={control}>
                  {CREDIT_METER_KEYS.map((key) => (
                    <option key={key} value={key}>{CREDIT_METER_LABELS[key]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity" htmlFor="grant-quantity" required>
                <input id="grant-quantity" required type="number" min="1" value={grant.quantity} onChange={(event) => editGrant({ quantity: event.target.value })} className={control} />
              </Field>
            </div>
            <Field label="Reason" htmlFor="grant-reason" required>
              <input id="grant-reason" required minLength={5} maxLength={500} value={grant.reason} onChange={(event) => setGrant({ ...grant, reason: event.target.value })} placeholder="Goodwill for an outage" className={control} />
            </Field>
            {grantError && <p role="alert" className="m-0 text-[14px] leading-[1.5] text-[var(--error-ink)]">{grantError}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy === "grant"}>
                {busy === "grant" ? "Granting…" : "Grant credits"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add a pack to an invoice */}
      <Dialog open={purchasePack !== null} onOpenChange={(open) => !open && setPurchasePack(null)}>
        <DialogContent>
          <form onSubmit={submitPurchase} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add {purchasePack?.name ?? "credit pack"} to an invoice</DialogTitle>
              <DialogDescription>
                Creates an invoice for the selected tenant through the custom-invoice path and grants the pack&apos;s credits in the
                same step, before the invoice is paid. Like any grant, the credits count for the current billing period only.
              </DialogDescription>
            </DialogHeader>
            <Field label="Tenant" htmlFor="purchase-tenant" required>
              <select id="purchase-tenant" required value={purchase.tenant_id} onChange={(event) => setPurchase({ ...purchase, tenant_id: event.target.value })} className={control}>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Number of packs"
              htmlFor="purchase-quantity"
              required
              hint={purchasePack ? `${count(purchasePack.quantity * (Number(purchase.quantity) || 0))} ${CREDIT_METER_LABELS[purchasePack.meter_key] ?? purchasePack.meter_key} · ${money(purchasePack.price_cents * (Number(purchase.quantity) || 0))}` : undefined}
            >
              <input id="purchase-quantity" required type="number" min="1" max="1000" value={purchase.quantity} onChange={(event) => setPurchase({ ...purchase, quantity: event.target.value })} className={control} />
            </Field>
            <Field label="Reason" htmlFor="purchase-reason" required>
              <input id="purchase-reason" required minLength={5} maxLength={500} value={purchase.reason} onChange={(event) => setPurchase({ ...purchase, reason: event.target.value })} placeholder="Customer requested a top-up" className={control} />
            </Field>
            {purchaseError && <p role="alert" className="m-0 text-[14px] leading-[1.5] text-[var(--error-ink)]">{purchaseError}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPurchasePack(null)}>Cancel</Button>
              <Button type="submit" disabled={busy === "purchase"}>
                {busy === "purchase" ? "Adding…" : "Add to invoice"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* One save bar for the pricing table, present only while something is dirty. Fixed to the
          bottom so it stays reachable on a long page without following you up it. */}
      {dirtyRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-rest)] lg:left-60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-8 py-3.5">
            <p className="m-0 text-[14px] leading-[1.5]">
              <span className="font-semibold text-[var(--ink)]">
                {dirtyRows.length === 1 ? "1 unsaved change" : `${dirtyRows.length} unsaved changes`}
              </span>
              <span className="text-[var(--muted)]">
                {" · "}
                {dirtyRows.map((row) => CREDIT_METER_LABELS[row.meter_key]).join(", ")}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft({})} disabled={busy === "pricing"}>
                Discard
              </Button>
              <Button type="button" onClick={() => void savePricing()} disabled={busy === "pricing"}>
                {busy === "pricing" ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonitorRow({ entry, onGrant }: { entry: MonitorEntry; onGrant: (prefill: { tenantId: string; meter: CreditMeterKey }) => void }) {
  const grantMeter = entry.grantMeter;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] px-4 py-3 first:border-t-0 lg:flex-nowrap">
      <span className="w-full min-w-0 lg:w-[230px] lg:shrink-0">
        <span className="block truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{entry.tenantName}</span>
        {entry.tenantStatus !== "active" && <span className={st.sub}>{entry.tenantStatus}</span>}
      </span>
      <span className="w-[150px] shrink-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{entry.label}</span>
      <span className="min-w-[120px] flex-1">
        <SettingsMeter
          value={entry.used}
          max={entry.limit}
          tone={METER_TONE[entry.state]}
          ariaLabel={`${entry.tenantName}, ${entry.label}: ${count(entry.used)} of ${count(entry.limit)}`}
        />
      </span>
      <span className={cn("w-[150px] shrink-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums", FIGURE_TONE[entry.state])}>
        {count(entry.used)} / {count(entry.limit)}
        {entry.addonQty > 0 && <span className={cn(st.sub, "font-normal")}>incl. {count(entry.addonQty)} from add-ons</span>}
        {entry.grantQty > 0 && <span className={cn(st.sub, "font-normal")}>incl. {count(entry.grantQty)} granted</span>}
      </span>
      <span className="flex w-[124px] shrink-0 justify-end">
        {grantMeter ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onGrant({ tenantId: entry.tenantId, meter: grantMeter })}>
            Grant credits
          </Button>
        ) : (
          <span
            className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]"
            title={entry.kind === "seats" ? "Seats come from the plan; change the plan to raise them." : "Credits cannot be granted on this meter."}
          >
            {entry.kind === "seats" ? "Set by the plan" : "Not grantable"}
          </span>
        )}
      </span>
    </li>
  );
}

function limitText(value: number | null) {
  if (value === null) return "Unlimited";
  if (value === 0) return "—";
  return count(value);
}

function DefaultLimitsRow({ row, planIds }: { row: DefaultLimitRow; planIds: string[] }) {
  return (
    <tr className="m-row">
      <td className={st.td}>{row.label}</td>
      {planIds.map((planId) => {
        const cell = row.values[planId];
        const value = cell?.value ?? null;
        return (
          <td
            key={planId}
            className={cn(st.td, "tabular-nums")}
            title={cell?.source === "platform_default" ? "Platform default: this plan sets no allowance of its own" : undefined}
          >
            {value === 0 ? (
              <>
                <span aria-hidden>—</span>
                <span className="sr-only">None</span>
              </>
            ) : (
              limitText(value)
            )}
          </td>
        );
      })}
    </tr>
  );
}
