"use client";

/**
 * Settings › Products, round 8 (board settings-r8/products-and-ai P1–P4, owner 2026-11-12; first built as
 * option A 2026-10-27, Notion LA-1.3 + SA-4.5). Two header tabs: In your plan and Not in your plan.
 *
 *   In your plan    one line per product, grouped by line (Life / Health / Retirement): the Sell switch (saves
 *                   at once with Undo; turning one off asks first, today's wording), the partners who may send
 *                   it, "What it needs" in call order as neutral text (a missing step on a product you sell is
 *                   a green "+" link to the Settings page that sets it up), and one Ready chip — the only
 *                   colour on the row. A row opens the product's sheet.
 *   Not in your plan  the products the plan doesn't include and the plan that adds each, linking to Billing.
 *
 * A status line under the title says where the page stands; no notice cards. Every product picker in the app
 * reads the same answer (lib/products/agencyProducts.ts). Readiness comes from GET /api/app/products/readiness
 * after the list, so the switches never wait for it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { SettingsSectionHeader } from "@/components/app/settings/primitives";
import { StatusLine } from "@/components/app/settings/sales-process/parts";
import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/field";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { matchesFilter, needsFor, readinessOf, type Need, type ProductFilter, type Readiness, type ReadinessPayload } from "@/lib/products/readiness";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";

import { NotInPlan } from "@/components/app/settings/products/not-in-plan";
import { CATEGORY_ORDER, lineOf, linkClass, NeedsLine, partnersShort, partnersText, type ProductRow as Row } from "./products/parts";
import { ProductSheet } from "@/components/app/settings/products/product-sheet";

type Tab = "in-plan" | "not-in-plan";
const SECTION = "products";

type Shown = Row & { needs: Need[] | null; ready: Readiness | null };

export function ProductsSettings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<Row | null>(null);
  const [facts, setFacts] = useState<ReadinessPayload | null>(null);
  const [factsFailed, setFactsFailed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("in-plan");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [query, setQuery] = useState("");
  const [openCode, setOpenCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    const response = await fetch("/api/app/settings/products", { cache: "no-store" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { products?: Row[]; error?: string } | null;
    if (!response?.ok || !body?.products) { setError(body?.error ?? "Your products could not be loaded."); return; }
    setRows(body.products);
  }, []);

  const loadFacts = useCallback(async () => {
    setFactsFailed(false);
    const response = await fetch("/api/app/products/readiness", { cache: "no-store" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as ReadinessPayload | null;
    if (!response?.ok || !body?.products) { setFactsFailed(true); return; }
    setFacts(body);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); void loadFacts(); }, 0);
    return () => window.clearTimeout(t);
  }, [load, loadFacts]);

  // The address names the tab (#products/not-in-plan), so a reload or a shared link comes back to it.
  useEffect(() => {
    const fromHash = () => {
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section === SECTION) setTab(anchor === "not-in-plan" ? "not-in-plan" : "in-plan");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const openTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${SECTION}${next === "not-in-plan" ? "/not-in-plan" : ""}`);
  };

  async function save(row: Row, sold: boolean, undoable = true) {
    // The switch moves at once (2026-10-29); a save that fails puts it back and the status line says so.
    const before = rows;
    setSaveError(null);
    setRows((current) => current?.map((item) => (item.code === row.code ? { ...item, enabled: sold, sold } : item)) ?? current);
    setBusy(row.code);
    const response = await fetch("/api/app/settings/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_code: row.code, sold }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { products?: Row[]; error?: string } | null;
    setBusy(null);
    if (!response?.ok || !body?.products) {
      setRows(before);
      setSaveError(`Couldn't save · ${row.name} is still ${sold ? "off" : "on"}${body?.error ? ` · ${body.error}` : ""}`);
      return;
    }
    setRows(body.products);
    notify.done(sold ? `You sell ${row.name}` : `You no longer sell ${row.name}`, {
      detail: sold ? "Leads, partners, forms and quotes now offer it." : "Nothing new can use it; what already exists keeps working.",
      action: undoable ? { label: "Undo", onClick: () => void save(row, !sold, false) } : undefined,
    });
  }

  const toggle = (row: Row, next: boolean) => {
    if (busy === row.code) return;
    if (next) void save(row, true);
    else setConfirmOff(row);
  };

  const shown = useMemo<Shown[]>(() => {
    if (!rows) return [];
    const byCode = new Map((facts?.products ?? []).map((f) => [f.code, f]));
    return rows.map((row) => {
      const needs = facts ? needsFor(row.category, byCode.get(row.code)) : null;
      return { ...row, needs, ready: needs ? readinessOf(row.sold, needs) : null };
    });
  }, [rows, facts]);

  const live = shown.filter((row) => row.inPlan);
  const locked = shown.filter((row) => !row.inPlan);
  const sold = live.filter((row) => row.sold).length;
  const notReady = live.filter((row) => row.sold && row.ready && row.ready.missing.length);
  const visible = live.filter((row) => matchesFilter(row, filter, query));
  const groups = [...new Set([...CATEGORY_ORDER, ...visible.map((row) => row.category)])]
    .map((category) => ({ category, rows: visible.filter((row) => row.category === category) }))
    .filter((group) => group.rows.length > 0);
  const open = shown.find((row) => row.code === openCode) ?? null;

  const header = (
    <SettingsSectionHeader
      tabs={(
        <ViewTabs
          label="Products"
          tabs={[
            { key: "in-plan" as Tab, label: "In your plan", count: rows ? live.length : null },
            ...(locked.length ? [{ key: "not-in-plan" as Tab, label: "Not in your plan", count: locked.length }] : []),
          ]}
          value={tab}
          onChange={openTab}
          controls="products-panel"
        />
      )}
      actions={<Button asChild variant="outline"><Link href="/app/settings#billing">See plans</Link></Button>}
    />
  );

  const status = (() => {
    if (!rows) return null;
    if (saveError) return <StatusLine tone="bad">{saveError}</StatusLine>;
    if (tab === "not-in-plan") return <StatusLine tone="muted">{facts?.planName ? `Your plan: ${facts.planName} · ${live.length} products` : `${live.length} products in your plan`}</StatusLine>;
    if (factsFailed) {
      return (
        <StatusLine tone="warn" action={<button type="button" onClick={() => void loadFacts()} className={cn("text-sm", linkClass)}>Try again</button>}>
          You sell {sold} of {live.length} · couldn&apos;t check what each one needs
        </StatusLine>
      );
    }
    if (sold === 0) return <StatusLine tone="muted">You don&apos;t sell anything yet · turn on the products you sell; partners can&apos;t send leads, and forms and quotes have nothing to offer, until you do</StatusLine>;
    if (!notReady.length) return <StatusLine tone="ok">You sell {sold} of {live.length}{facts ? " · every one is ready to quote" : ""}</StatusLine>;
    return (
      <StatusLine tone="warn">
        You sell {sold} of {live.length} · {notReady.length} {notReady.length === 1 ? "isn't" : "aren't"} ready to quote yet —{" "}
        {notReady.slice(0, 2).map((row, index) => (
          <span key={row.code}>
            {index > 0 && ", "}
            <button type="button" onClick={() => setOpenCode(row.code)} className={linkClass}>{row.name} needs {row.ready!.missing.map((need) => need.missingWords).join(" and ")}</button>
          </span>
        ))}
        {notReady.length > 2 && ` and ${notReady.length - 2} more`}
      </StatusLine>
    );
  })();

  const counts = {
    all: live.length,
    sold,
    setup: notReady.length,
    off: live.length - sold,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:h-full">
      {header}
      {status}
      <div id="products-panel" role="tabpanel" aria-label={tab === "in-plan" ? "In your plan" : "Not in your plan"} className="flex min-h-0 flex-1 flex-col">
        {error ? (
          <TableCard title="Products">
            <ErrorState title="Couldn't load your products" detail="What you sell hasn't changed; only this page failed." action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
          </TableCard>
        ) : !rows ? (
          <TableCard title="Products"><SectionLoading rows={6} columns={5} label="Loading your products" /></TableCard>
        ) : tab === "not-in-plan" ? (
          <NotInPlan rows={locked} addedBy={facts?.addedBy ?? null} />
        ) : (
          <TableCard
            className="min-h-0 flex-1"
            bodyClassName="flex min-h-0 flex-col"
            toolbar={(
              <>
                <Segmented<ProductFilter>
                  label="Show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { key: "all", label: "All", count: counts.all },
                    { key: "sold", label: "Sold", count: counts.sold },
                    ...(facts ? [{ key: "setup" as ProductFilter, label: "Needs setup", count: counts.setup }] : []),
                    { key: "off", label: "Not sold", count: counts.off },
                  ]}
                />
                <ToolbarSearch value={query} onChange={setQuery} placeholder="Find a product" className="sm:ml-auto sm:w-56" />
              </>
            )}
            footer={<span>A switch saves at once and offers Undo · turning one off asks first · &ldquo;+&rdquo; links open the page that fixes it</span>}
          >
            <div id="products-list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {live.length === 0 ? (
                <EmptyState title="Your plan has no products yet" hint="See plans to find the plan that adds the products you sell." />
              ) : visible.length === 0 ? (
                <NoMatches noun="products" by={query ? "search" : "filters"} onClear={() => { setFilter("all"); setQuery(""); }} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Sell</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Partners who may send it</TableHead>
                      <TableHead>What it needs</TableHead>
                      <TableHead>Ready</TableHead>
                      <TableHead className="w-8" aria-label="Open" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => [
                      <TableRow key={`g-${group.category}`} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-[var(--surface-alt)] py-1.5 text-xs font-semibold text-[var(--muted)]">{lineOf(group.category)}</TableCell>
                      </TableRow>,
                      ...group.rows.map((row) => (
                        <TableRow key={row.code} onClick={() => setOpenCode(row.code)} className="cursor-pointer">
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <Switch checked={row.enabled} label={`Sell ${row.name}`} onChange={(next) => toggle(row, next)} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <button type="button" onClick={(event) => { event.stopPropagation(); setOpenCode(row.code); }} className="text-sm font-semibold text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                              {row.name}
                            </button>
                          </TableCell>
                          <TableCell className="max-w-56 truncate whitespace-nowrap text-[var(--body)]">{partnersShort(row)}</TableCell>
                          <TableCell><NeedsLine needs={row.needs} sold={row.sold} /></TableCell>
                          <TableCell className="whitespace-nowrap">
                            {row.ready ? <StatusChip tone={row.ready.tone} dot={false}>{row.ready.label}</StatusChip> : <StatusChip tone="neutral" dot={false}>{row.sold ? "Sold" : "Not sold"}</StatusChip>}
                          </TableCell>
                          <TableCell className="text-[var(--muted)]"><ChevronRight aria-hidden className="size-4" /></TableCell>
                        </TableRow>
                      )),
                    ])}
                  </TableBody>
                </Table>
              )}
            </div>
          </TableCard>
        )}
      </div>

      {open && (
        <ProductSheet
          row={open}
          needs={open.needs}
          ready={open.ready}
          busy={busy === open.code}
          onToggle={(next) => toggle(open, next)}
          onClose={() => setOpenCode(null)}
        />
      )}

      <Dialog open={confirmOff !== null} onOpenChange={(next) => { if (!next) setConfirmOff(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          {confirmOff && (
            <>
              <DialogHeader>
                <DialogTitle>Stop selling {confirmOff.name}?</DialogTitle>
                <DialogDescription>Nothing is deleted.</DialogDescription>
              </DialogHeader>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-[var(--body)]">
                <li>{confirmOff.partners.length ? `${partnersText(confirmOff.partners).replace(" may send it", "")} can no longer send ${confirmOff.name}.` : `No partner sends ${confirmOff.name} today.`}</li>
                <li>New leads, lead imports, forms and quotes stop offering it.</li>
                <li>{confirmOff.name} leads, applications and policies already in Insurvas keep working.</li>
              </ul>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmOff(null)}>Keep selling it</Button>
                <Button type="button" variant="destructive" onClick={() => { const row = confirmOff; setConfirmOff(null); void save(row, false); }}>Stop selling {confirmOff.name}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
