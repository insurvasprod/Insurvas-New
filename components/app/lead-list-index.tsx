"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, ArrowUpDown, Check, ChevronDown, MoreHorizontal, PhoneCall, Receipt, Recycle, RotateCw, Store, Trash2, Upload, Users, Wrench, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { ClearFiltersButton, DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/app/lead-ops-view-tabs";
import { useSolo } from "@/components/app/solo-context";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { deleteCampaign } from "@/components/app/campaigns/delete-campaign";
import { cn } from "@/lib/utils";

/**
 * The lead-list index, step 5 · Lists of the one Leads page (owner pick B, 2026-10-28, board LinB4;
 * owner pass 2026-10-29): four totals, then one table drawn like the Source step's — the list and its
 * vendor, its status (one chip), what is left to call, what a usable lead cost, and, only while
 * something is owed, the money the vendor owes back — then its next step: exactly one button (owner
 * 2026-10-29), the rest in a ⋯ menu. A row opens its list. Rows needing you come first by default.
 *
 * Owner 2026-10-29: a problem that stops a list being dialed (not scrubbed, a failed scrub, leads
 * outside your states) is fixed on the Clean step, so a row only points there ("Fix in Clean"). A
 * stalling list stays here, because handing its leads out (Assign) is the fix. The step fits the
 * window: the table scrolls inside its card and the pager stays at the card's foot.
 *
 * Everything here is counted from rows (lib/leadLists/service.ts), never stored: a stored "usable"
 * is wrong the moment somebody dials one.
 */

export type LeadListIndexRow = {
  campaignId: string; campaignName: string; vendorName: string; status: string; createdAt: string;
  recordsPurchased: number; totalSpendCents: number; creditsReceivedCents: number;
  leadsReceived: number; untouched: number; assigned: number; byState: Record<string, number>;
  scrubStatus: string; offTerritory: number | null; offTerritoryStates: number; lastTouchedAt: string | null; claimable: number;
};

type ListState = "working" | "stalling" | "exhausted" | "blocked" | "empty";
type StateFilter = "all" | ListState;

const STALL_MS = 7 * 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "No list yet" and "Not scrubbed" are the Source step's words for the same two facts.
const STATE_UI: Record<ListState, { label: string; tone: StatusTone }> = {
  working: { label: "Working", tone: "good" },
  stalling: { label: "Stalling", tone: "warning" },
  exhausted: { label: "Used up", tone: "neutral" },
  blocked: { label: "Can't be dialed", tone: "danger" },
  empty: { label: "No list yet", tone: "neutral" },
};
/** The filter's own, shorter words, so state, search and vendor share one line at 1440px (owner 2026-10-29). */
const FILTER_LABEL: Record<ListState | "all", string> = { all: "All", working: "Working", stalling: "Stalling", blocked: "Can't dial", exhausted: "Used up", empty: "No list" };
/** The order the owner named (2026-10-29), each with its count, always on view in the toolbar. */
const STATE_FILTERS: StateFilter[] = ["all", "working", "stalling", "blocked", "exhausted", "empty"];
const isStateFilter = (value: string | null): value is StateFilter => STATE_FILTERS.includes(value as StateFilter);
/** The filters' keys in the address (replaced, not pushed), apart from the panel's `list` / `tab`. */
const PARAM = { state: "health", vendor: "vendor_name", search: "q", sort: "sort" } as const;
/**
 * The table's order: what needs you first (the default), or the newest upload first. Switched by
 * clicking the List header, so the one-line toolbar keeps its room at 1440px; the pager names it.
 */
type SortOrder = "needs" | "newest";
/** Where Used up lists are brought back (Lead sources › 7 Recycle). It picks its own campaign, so no id is passed. */
const RECYCLE_HREF = "/app/nurture";
/** Solo mode: a list's unowned leads are already the agent's, served by the dialer (it reads only ?lead=). */
const DIALER_HREF = "/app/dialer";
const fromAddress = (key: string) => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(key) ?? "");
/** The licensed-states step of Settings › Carriers, where "outside your states" is fixed. */
const STATES_HREF = "/app/settings#carriers/carriers-states";
/** Vendor bills › Returns, where a claim is drafted. Offered only to the people it opens for. */
const RETURNS_HREF = "/app/vendor-bills?tab=returns";

/** Two decimals everywhere, as the Source step draws its per-usable cost. Costs per lead are fractional cents; they round here. */
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wholeMoney = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const shortDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function live(list: LeadListIndexRow) {
  return (list.byState.fresh ?? 0) + (list.byState.working ?? 0) + (list.byState.retry ?? 0);
}
function costPerUsable(list: LeadListIndexRow) {
  return list.leadsReceived > 0 ? list.totalSpendCents / list.leadsReceived : null;
}

/** One reading per list, decided in order: the scrub gate first, because nothing else matters if it is shut. */
function stateOf(list: LeadListIndexRow, now: number): ListState {
  if (list.leadsReceived === 0) return "empty";
  if (list.scrubStatus !== "scrubbed") return "blocked";
  if (live(list) === 0) return "exhausted";
  const lastTouched = list.lastTouchedAt ? Date.parse(list.lastTouchedAt) : Date.parse(list.createdAt);
  if ((list.byState.fresh ?? 0) > 0 && Number.isFinite(lastTouched) && now - lastTouched > STALL_MS) return "stalling";
  return "working";
}

/**
 * The health cell's tooltip (the whole story), and the problem the Clean step fixes, if any: the
 * scrub gate, or leads in states nobody here is licensed in. No reason lines under the chip.
 */
function healthOf(list: LeadListIndexRow, state: ListState): { detail: string; fix: string | null } {
  const fresh = list.byState.fresh ?? 0;
  const off = list.offTerritory;
  const parts: string[] = [];
  let fix: string | null = null;
  if (state === "empty") {
    parts.push("No leads have arrived against this list yet. Import a file against it.");
  } else if (state === "blocked") {
    fix = list.scrubStatus === "failed" ? "The scrub failed" : "Not scrubbed";
    parts.push(list.scrubStatus === "failed"
      ? "The scrub failed, so none of these leads are served to the dialer until it is resumed."
      : "This list has not been scrubbed, so none of its leads are served to the dialer yet.");
  } else if (state === "stalling") {
    parts.push(`${plural(fresh, "lead has", "leads have")} never been dialed, and nothing on this list has moved for over a week.`);
  } else if (state === "exhausted") {
    parts.push("Every lead on this list has been worked through.");
  } else if (fresh > 0) {
    parts.push(`${plural(fresh, "lead", "leads")} not dialed yet.`);
  }
  if (state !== "empty") {
    if (off != null && off > 0) {
      // Told in the tooltip and fixed on Clean › List problems, but not the row's next step: leads outside
      // your states do not stop the list being dialed, so they must not outrank Assign (owner screenshot
      // 2026-10-29: nearly every working list said "Fix in Clean").
      parts.push(`${plural(off, "lead is", "leads are")} in ${plural(list.offTerritoryStates, "state", "states")} nobody here is licensed in — see Clean › List problems.`);
    } else if (off === 0) {
      parts.push("Every lead is in a state you are licensed in.");
    } else {
      parts.push("No licensed states are recorded, so territory is not checked.");
    }
  }
  return { detail: parts.join(" "), fix };
}

/** How much of the list is worked (dialled at least once), as one thin green bar; the counts are in its tooltip. */
function WorkedThrough({ list }: { list: LeadListIndexRow }) {
  const total = Math.max(1, list.leadsReceived);
  const fresh = list.byState.fresh ?? 0;
  const closed = list.byState.closed ?? 0;
  const cadence = (list.byState.working ?? 0) + (list.byState.retry ?? 0) + (list.byState.nurture ?? 0);
  const done = list.byState.exhausted ?? 0;
  const dialled = Math.round((Math.max(0, list.leadsReceived - fresh) / total) * 100);
  return (
    <span className="mx-auto mt-1 block w-full max-w-[120px]" title={`${dialled}% worked · ${closed} closed · ${cadence} in cadence · ${done} exhausted · ${fresh} never dialed`}>
      <span className="m-meter flex h-1 w-full overflow-hidden rounded-full bg-[var(--surface-alt)]" role="img" aria-label={`${dialled}% worked`}>
        <span className="block h-1 bg-[var(--success)]" style={{ width: `${dialled}%` }} />
      </span>
    </span>
  );
}

/** A list's health as one chip, the same reading on its row and in its panel's header. */
export function ListStateChip({ list, nowAt }: { list: LeadListIndexRow; nowAt: number }) {
  const ui = STATE_UI[stateOf(list, nowAt)];
  return <StatusChip tone={ui.tone} dot>{ui.label}</StatusChip>;
}

/** The panel's sections (lead-list-panel.tsx), named here so a row's action can open the right one. */
export type LeadListPanelTab = "overview" | "leads" | "removed" | "columns";
/** What a row's action starts once its panel is open: the assign drawer, or the scrub. */
export type LeadListPanelIntent = "assign" | "scrub" | null;

/**
 * A row's next step: exactly one per row, chosen in this order (owner 2026-10-29): a problem the Clean
 * step fixes, an empty list to import into, money owed back, leads nobody owns, a used-up list to
 * recycle, else a quiet Open. "blocked" is the Clean problem for someone the Clean gate turns away:
 * the reason, muted, instead of a button. The default "Needs you first" order sorts by this rank.
 */
type StepKind = "fix" | "blocked" | "import" | "claim" | "assign" | "recycle" | "open";
const STEP_RANK: Record<StepKind, number> = { fix: 0, blocked: 0, import: 1, claim: 2, assign: 3, recycle: 4, open: 5 };
/** One width for every next-step button, so they line up down the column. */
const STEP_BUTTON = "w-[8.5rem] justify-start";
/** The buttons a step draws in the panel-opening style: label, tooltip, icon, and where the panel opens. */
type RowAction = { label: string; title: string; tab: LeadListPanelTab; intent: LeadListPanelIntent; Icon: LucideIcon };

/** The vendor filter: a small searchable picker in the toolbar (owner 2026-10-29), not a chip cloud. */
function VendorPicker({ vendors, value, onChange }: { vendors: string[]; value: string; onChange: (vendor: string) => void }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const shown = needle ? vendors.filter((name) => name.toLowerCase().includes(needle)) : vendors;
  const pick = (vendor: string) => { onChange(vendor); setOpen(false); setFind(""); };
  const option = (vendor: string, label: string) => (
    <button
      key={vendor || "all"}
      type="button"
      role="radio"
      aria-checked={value === vendor}
      onClick={() => pick(vendor)}
      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-[var(--ink)] outline-none hover:bg-[var(--surface-alt)] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Check aria-hidden="true" className={cn("size-3.5 shrink-0", value === vendor ? "text-[var(--accent-ink)]" : "invisible")} />
      <span className="min-w-0 truncate" title={label}>{label}</span>
    </button>
  );
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setFind(""); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="max-w-[10rem]" title={value || "All vendors"} aria-label={`Vendor: ${value || "All vendors"}`}>
          <Store aria-hidden="true" />
          {/* "Vendors" until one is picked; then its name (owner 2026-10-29). */}
          <span className="min-w-0 truncate">{value || "Vendors"}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <label className="block">
          <span className="sr-only">Find a vendor</span>
          <input
            type="search"
            autoFocus
            value={find}
            onChange={(event) => setFind(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && shown[0]) { event.preventDefault(); pick(shown[0]); } }}
            placeholder="Find a vendor"
            className={cn(toolbarControl, "w-full")}
          />
        </label>
        <div role="radiogroup" aria-label="Vendor" className="mt-2 flex max-h-60 flex-col gap-0.5 overflow-y-auto">
          {!needle && option("", "All vendors")}
          {shown.map((name) => option(name, name))}
          {shown.length === 0 && <p className="m-0 px-2 py-1.5 text-xs text-[var(--muted)]">No vendor matches</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function LeadListIndex({ lists, licensedStates, onOpen, nowAt, onRefresh, canClaim = false, canDelete = false, spend = true, cleanHref = null, autoAssign }: {
  lists: LeadListIndexRow[];
  licensedStates: string[];
  /** Opens the list's panel, on a section and with an action to start when a row's button asked for one. */
  onOpen: (list: LeadListIndexRow, tab?: LeadListPanelTab, intent?: LeadListPanelIntent) => void;
  nowAt: number;
  /** Reloads the lists. The toolbar's Refresh button is drawn only when the parent passes it. */
  onRefresh?: () => Promise<unknown> | void;
  /** May this person draft a vendor claim (True CPA, owner / producer)? The claim itself is in the list's panel. */
  canClaim?: boolean;
  /** May this person delete an empty list's campaign (owner / producer, not read-only)? 2026-10-29 clean-up. */
  canDelete?: boolean;
  /** May this person see what the lists cost (owner, producer)? An assistant sees the inventory only. */
  spend?: boolean;
  /** The Clean step, when this person may open it: a row's "Fix in Clean" lands on its List problems. */
  cleanHref?: string | null;
  /** The toolbar's Auto-assign (lead-list-auto-assign.tsx), for the people who may route. */
  autoAssign?: ReactNode;
}) {
  // Solo mode (owner 2026-10-29): nobody to assign to, so a list's "Assign" is "Call now" (the dialer
  // serves the unassigned pool to an agent working alone, lib/dialerScripts/service.ts serveNextLead).
  const solo = useSolo();
  // The filters live in the address, so a refresh or a shared link keeps them (replaced, not pushed).
  // Read at first render: this index only mounts in the browser, once the workspace has loaded.
  const [vendor, setVendor] = useState(() => fromAddress(PARAM.vendor));
  const [stateFilter, setStateFilter] = useState<StateFilter>(() => { const state = fromAddress(PARAM.state); return isStateFilter(state) ? state : "all"; });
  const [search, setSearch] = useState(() => fromAddress(PARAM.search));
  const [sort, setSort] = useState<SortOrder>(() => (fromAddress(PARAM.sort) === "newest" ? "newest" : "needs"));
  const [page, setPage] = useState(1);
  // As many rows as the card's table area actually holds (owner 2026-10-29: 4 pages of lists but empty
  // space under 7 rows). Measured from the area itself, its header and a real row, and again whenever
  // it resizes; the viewport estimate is only the first guess.
  const estimate = useFittingPageSize(460, 60);
  const tableWrap = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  useEffect(() => {
    // The card's own height (it fills the step), minus its toolbar and pager and the table's header,
    // divided by a real row. Not the table box itself: that shrinks to its rows and would feed back.
    const card = tableWrap.current?.firstElementChild as HTMLElement | null | undefined;
    if (!card) return;
    const measure = () => {
      const table = card.querySelector("table");
      if (!table) return;
      const box = [...card.children].find((child) => child.contains(table));
      const chrome = [...card.children].filter((child) => child !== box).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      const head = table.querySelector("thead")?.getBoundingClientRect().height ?? 40;
      const row = table.querySelector("tbody tr")?.getBoundingClientRect().height || 54;
      const rows = Math.max(3, Math.floor((card.clientHeight - chrome - head) / row));
      setFit((current) => (current === rows ? current : rows));
    };
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(card);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [lists.length]);
  const PAGE_SIZE = fit ?? estimate;
  const [refreshing, setRefreshing] = useState(false);
  // The frame's corner slot for "Claim $N" (LeadSourcesPage renders it only for people who may claim).
  const [claimSlot, setClaimSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setClaimSlot(document.getElementById("leads-in-claim")); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  useEffect(() => {
    const url = new URL(window.location.href);
    const put = (key: string, value: string) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); };
    put(PARAM.state, stateFilter === "all" ? "" : stateFilter);
    put(PARAM.vendor, vendor);
    put(PARAM.search, search.trim());
    put(PARAM.sort, sort === "needs" ? "" : sort);
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", next);
  }, [stateFilter, vendor, search, sort]);

  const vendors = useMemo(() => [...new Set(lists.map((list) => list.vendorName))].sort(), [lists]);

  /** Usable leads nobody owns, on an active scrubbed list: the assign drawer can hand them out. */
  const assignable = (list: LeadListIndexRow) => list.scrubStatus === "scrubbed" && list.status === "active" && (list.untouched > 0 || list.leadsReceived - list.assigned > 0);
  /** The one next step, in the owner's order (see StepKind). */
  function stepOf(list: LeadListIndexRow, state: ListState, fix: string | null): StepKind {
    if (fix && cleanHref) return "fix";
    if (state === "blocked") return "blocked";
    if (state === "empty") return "import";
    if (canClaim && list.claimable > 0) return "claim";
    if (assignable(list)) return "assign";
    // Recycle (Lead sources › 7) opens for the people who see money, owners and producers.
    if (state === "exhausted" && spend) return "recycle";
    return "open";
  }

  const rows = useMemo(() => {
    const read = lists.map((list) => {
      const state = stateOf(list, nowAt);
      const health = healthOf(list, state);
      return { list, state, ...health, step: stepOf(list, state, health.fix) };
    });
    const newest = (a: (typeof read)[number], b: (typeof read)[number]) => (Date.parse(b.list.createdAt) || 0) - (Date.parse(a.list.createdAt) || 0);
    return read.sort(sort === "needs" ? (a, b) => STEP_RANK[a.step] - STEP_RANK[b.step] || newest(a, b) : newest);
    // stepOf reads only the props named here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, nowAt, sort, canClaim, cleanHref, spend]);

  const needle = search.trim().toLowerCase();
  // The vendor and the search narrow first; the state chips count within them.
  const narrowed = rows.filter(({ list }) => (!vendor || list.vendorName === vendor) && (!needle || `${list.campaignName} ${list.vendorName}`.toLowerCase().includes(needle)));
  const shown = narrowed.filter(({ state }) => stateFilter === "all" || state === stateFilter);
  const { current, rows: pageRows } = paginate(shown, page, PAGE_SIZE);
  const stateCount = (key: StateFilter) => (key === "all" ? narrowed.length : narrowed.filter(({ state }) => state === key).length);

  // Figures across every list, not just the filtered page: the strip is the whole inventory.
  const usableLeft = lists.reduce((n, list) => n + live(list), 0);
  const openLists = lists.filter((list) => list.status === "active");
  const openSpend = openLists.reduce((n, list) => n + list.totalSpendCents, 0);
  const openVendors = new Set(openLists.map((list) => list.vendorName)).size;
  const territoryKnown = licensedStates.length > 0;
  const offTotal = lists.reduce((n, list) => n + (list.offTerritory ?? 0), 0);
  const claimableCents = lists.reduce((n, list) => n + list.claimable * (costPerUsable(list) ?? 0), 0);
  // The Owed back column is drawn only while some list has something to claim, and only for someone
  // who may see money.
  const anyClaimable = spend && lists.some((list) => list.claimable > 0);

  const filtered = Boolean(vendor) || stateFilter !== "all" || Boolean(needle);
  const clearFilters = () => { setVendor(""); setStateFilter("all"); setSearch(""); setPage(1); };
  async function refresh() {
    if (!onRefresh) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }

  // Clean-up (2026-10-29): a list nothing was imported into is just an empty campaign, and goes for
  // good. The server refuses one with any history (DELETE /api/app/campaigns/[id]) and says why.
  const [deleting, setDeleting] = useState<string | null>(null);
  async function removeEmpty(list: LeadListIndexRow) {
    const ok = await confirmAction({
      title: `Delete ${list.campaignName}?`,
      description: "Nothing was imported into it. Its campaign is removed for good, with its own cadence and scripts.",
      confirmLabel: "Delete list",
      cancelLabel: "Keep list",
    });
    if (!ok) return;
    setDeleting(list.campaignId);
    try {
      if (await deleteCampaign(list.campaignId, list.campaignName)) await onRefresh?.();
    } finally {
      setDeleting(null);
    }
  }

  // The page's next step: the biggest pile of usable work nobody owns. That row's action carries a
  // green icon — the one filled button on the page stays "Continue". (The scrub moved to Clean.)
  const nextStepId = useMemo(() => {
    const unassigned = lists.filter((list) => list.untouched > 0 && list.scrubStatus === "scrubbed" && list.status === "active").sort((a, b) => b.untouched - a.untouched)[0];
    return unassigned?.campaignId ?? null;
  }, [lists]);

  /** The panel-opening steps. Assign covers untouched leads and, QA 2026-10-29, a worked list's unowned ones. */
  const claimAction = (list: LeadListIndexRow): RowAction => ({ label: "Claim", title: `Claim ${plural(list.claimable, "lead", "leads")} back from ${list.vendorName}`, tab: "removed", intent: null, Icon: Receipt });
  const assignAction = (list: LeadListIndexRow): RowAction => ({ label: "Assign", title: list.untouched > 0 ? `Assign ${list.campaignName}'s untouched leads` : `Assign ${list.campaignName}'s unowned leads`, tab: "leads", intent: "assign", Icon: Users });
  const openAction = (list: LeadListIndexRow): RowAction => ({ label: "Open", title: `Open ${list.campaignName}`, tab: "overview", intent: null, Icon: ArrowRight });

  const link = "font-semibold text-[var(--accent-ink)] hover:underline";
  const statesAction = !territoryKnown ? <Link className={link} href={STATES_HREF}>Add your states</Link>
    : offTotal > 0 ? <Link className={link} href={STATES_HREF}>Licensed states</Link> : undefined;
  const owedAction = canClaim && claimableCents > 0 ? <Link className={link} href={RETURNS_HREF}>See returns</Link> : undefined;
  const stripFoot = Boolean(statesAction || owedAction);

  // Balanced widths across the full table (owner 2026-10-29, the Source step's rule): List read from
  // the left, every other column centred under its title. Written out so Tailwind sees each class.
  const widths = spend
    ? anyClaimable
      ? { list: "w-[26%]", health: "w-[14%]", untouched: "w-[15%]", cost: "w-[13%]", owed: "w-[12%]", action: "w-[20%]" }
      : { list: "w-[29%]", health: "w-[16%]", untouched: "w-[18%]", cost: "w-[15%]", owed: "", action: "w-[22%]" }
    : { list: "w-[34%]", health: "w-[20%]", untouched: "w-[22%]", cost: "", owed: "", action: "w-[24%]" };

  // Auto-assign and Refresh always sit at the right end of the table's own toolbar (owner 2026-10-29).
  const actions = (filtered || autoAssign || onRefresh) ? <>
    {filtered && <ClearFiltersButton onClick={clearFilters} />}
    {autoAssign}
    {/* Icon-only, named on hover: the ~60px it saves keeps the whole toolbar on one line at 1440px. */}
    {onRefresh && <Button type="button" variant="outline" size="icon" title="Refresh" aria-label="Refresh" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}><RotateCw className={cn(refreshing && "animate-spin")} aria-hidden="true" /></Button>}
  </> : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
      {canClaim && claimSlot && claimableCents > 0 && createPortal(
        <Button asChild variant="outline"><Link href={RETURNS_HREF}><Receipt aria-hidden="true" />Claim {money(claimableCents)}</Link></Button>,
        claimSlot,
      )}

      <StatStrip label="Lead list totals">
        <StatTile label="Usable leads left" labelTitle="Never dialed, or still mid-cadence, across every list." value={usableLeft.toLocaleString()} valueTone={usableLeft > 0 ? "good" : undefined} reserveFootnote={stripFoot} />
        {spend
          ? <StatTile label="Spend on open lists" labelTitle={`What the active lists cost, across ${openVendors} ${openVendors === 1 ? "vendor" : "vendors"}.`} value={wholeMoney(openSpend)} reserveFootnote={stripFoot} />
          : <StatTile label="Open lists" labelTitle={`Active lists, across ${openVendors} ${openVendors === 1 ? "vendor" : "vendors"}.`} value={openLists.length.toLocaleString()} reserveFootnote={stripFoot} />}
        <StatTile
          label="Outside your states"
          labelTitle={territoryKnown
            ? `Leads in states nobody here is licensed in. Your states: ${licensedStates.join(", ")}. Add a licence in Settings › Carriers to bring them in.`
            : "No licensed states are recorded yet, so this cannot be counted. Add them in Settings › Carriers."}
          value={territoryKnown ? offTotal.toLocaleString() : "—"}
          valueTone={offTotal > 0 ? "warning" : undefined}
          action={statesAction}
          reserveFootnote={stripFoot}
        />
        {spend && <StatTile label="Owed back" labelTitle="Bad leads the vendor can still be asked to refund, while their return windows are open." value={money(claimableCents)} valueTone={claimableCents > 0 ? "good" : undefined} action={owedAction} reserveFootnote={stripFoot} />}
      </StatStrip>

      <div ref={tableWrap} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TableCard
        // The Source step's card: it takes the step's remaining height, the rows scroll inside it under
        // sticky headers, and the pager stays at its foot (owner 2026-10-29: no page scroll at 1440×900).
        className="portal-campaigns-table flex min-h-[360px] min-w-0 flex-1 flex-col lg:min-h-0 [&>div.overflow-x-auto]:min-h-0 [&>div.overflow-x-auto]:flex-1 [&>div.overflow-x-auto]:overflow-y-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1]"
        toolbar={
          // One line (owner 2026-10-29): search, list state with its counts, vendor, then Auto-assign and
          // Refresh at the right end. The actions ride in the same wrapping row (not DataToolbar's own
          // actions box, which would squeeze the filters into a column), so on a narrower screen the
          // vendor and the actions drop to a second line together, the actions still at the right.
          <DataToolbar>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search" className="sm:w-28" />
            <Segmented
              label="List state"
              options={STATE_FILTERS.map((key) => ({ key, label: FILTER_LABEL[key], count: stateCount(key), tone: key === "blocked" && stateCount(key) > 0 ? "danger" as const : undefined }))}
              value={stateFilter}
              onChange={(next) => { setStateFilter(next); setPage(1); }}
            />
            {vendors.length > 1 && <VendorPicker vendors={vendors} value={vendor} onChange={(next) => { setVendor(next); setPage(1); }} />}
            {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
          </DataToolbar>
        }
        footer={<Pager page={current} total={shown.length} noun="lists" pageSize={PAGE_SIZE} onPage={setPage} suffix={`${shown.length < lists.length ? `${lists.length} in all · ` : ""}${sort === "needs" ? "needs you first" : "newest upload first"}`} />}
      >
        {lists.length === 0 ? (
          <EmptyState
            title="No lead lists yet"
            hint="Import a CSV against a campaign to start one."
            action={<Button asChild type="button"><Link href="/app/import">Import a list</Link></Button>}
          />
        ) : shown.length === 0 ? (
          <NoMatches noun="lists" onClear={clearFilters} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {/* `!` because globals.css sets the header cells left, unlayered (the Source step's fix). */}
                <TableHead className={cn(widths.list, "!text-left")} aria-sort={sort === "newest" ? "descending" : "none"}>
                  <button
                    type="button"
                    onClick={() => { setSort(sort === "needs" ? "newest" : "needs"); setPage(1); }}
                    title={sort === "needs" ? "Needs you first · click for newest upload first" : "Newest upload first · click for needs you first"}
                    className="inline-flex items-center gap-1 rounded-md font-semibold outline-none hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    List
                    <span className="text-xs font-normal text-[var(--muted)]">· {sort === "needs" ? "needs you first" : "newest first"}</span>
                    <ArrowUpDown aria-hidden="true" className="size-3.5 text-[var(--muted)]" />
                  </button>
                </TableHead>
                <TableHead className={cn(widths.health, "!text-center")}>Status</TableHead>
                <TableHead className={cn(widths.untouched, "!text-center")}>
                  <span className="inline-flex items-center gap-0.5">Left to call<InfoTip label="About left to call">Never dialed and nobody owns them, of the usable leads that arrived. The green bar is how much of the list has been dialed. Hover a bar for the counts.</InfoTip></span>
                </TableHead>
                {spend && <TableHead className={cn(widths.cost, "!text-center")}>
                  <span className="inline-flex items-center gap-0.5">Per usable<InfoTip label="About cost per usable lead">What you paid for the list, divided by the leads that arrived after the scrub. Under it, what the list cost.</InfoTip></span>
                </TableHead>}
                {anyClaimable && <TableHead className={cn(widths.owed, "!text-center")}>Owed back</TableHead>}
                <TableHead className={cn(widths.action, "!text-left")}>Next step</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(({ list, state, detail, fix, step }) => {
                const cost = costPerUsable(list);
                const ui = STATE_UI[state];
                const uploaded = shortDate(list.createdAt);
                const urgent = list.campaignId === nextStepId;
                const claimCents = list.claimable * (cost ?? 0);
                // The panel steps draw the same outline button; Open is the quiet one.
                const action = step === "claim" ? claimAction(list) : step === "assign" && !solo ? assignAction(list) : step === "open" ? openAction(list) : null;
                // Everything else this row can do goes in its ⋯ menu, never as a second button.
                const more: RowAction[] = [
                  ...(step !== "open" ? [openAction(list)] : []),
                  ...(step !== "claim" && canClaim && list.claimable > 0 ? [claimAction(list)] : []),
                  ...(step !== "assign" && assignable(list) && !solo ? [assignAction(list)] : []),
                ];
                const importHref = `/app/import?campaign=${list.campaignId}`;
                const sub = [list.vendorName, list.recordsPurchased > 0 ? `${list.recordsPurchased.toLocaleString()} bought` : null, uploaded || null].filter(Boolean).join(" · ");
                return (
                  <TableRow key={list.campaignId} className="portal-campaigns-row" onClick={() => onOpen(list)}>
                    <TableCell className="max-w-0 !text-left">
                      {/* The row opens the list; this button is its keyboard way in. */}
                      <button type="button" title={`Open ${list.campaignName}`} onClick={(event) => { event.stopPropagation(); onOpen(list); }} className="portal-campaigns-name block max-w-full truncate hover:underline">
                        {list.campaignName}
                      </button>
                      <span className="portal-campaigns-sub truncate" title={sub}>{sub}</span>
                    </TableCell>
                    <TableCell className="!text-center" title={detail}>
                      <StatusChip tone={ui.tone} dot>{ui.label}</StatusChip>
                    </TableCell>
                    {state === "empty" ? (
                      <TableCell className="!text-center text-[var(--muted)]">—</TableCell>
                    ) : (
                      <TableCell className="!text-center tabular-nums">
                        <span className="whitespace-nowrap">
                          <span className="text-base font-semibold text-[var(--ink)]">{list.untouched.toLocaleString()}</span>
                          <span className="ml-1 text-xs text-[var(--muted)]">of {list.leadsReceived.toLocaleString()} usable</span>
                        </span>
                        <WorkedThrough list={list} />
                      </TableCell>
                    )}
                    {spend && (
                      <TableCell className="!text-center tabular-nums">
                        {cost == null || state === "blocked" ? <span className="text-[var(--muted)]">—</span> : <span className="text-[var(--ink)]">{money(cost)}</span>}
                        {list.totalSpendCents > 0 && <span className="portal-campaigns-sub" title="What the list cost">{wholeMoney(list.totalSpendCents)}</span>}
                      </TableCell>
                    )}
                    {anyClaimable && (
                      <TableCell className="!text-center tabular-nums">
                        {list.claimable > 0 ? (
                          <>
                            <span className="font-semibold text-[var(--success-ink)]">{money(claimCents)}</span>
                            <span className="portal-campaigns-sub">{plural(list.claimable, "lead", "leads")}</span>
                          </>
                        ) : <span className="text-[var(--muted)]">—</span>}
                      </TableCell>
                    )}
                    <TableCell className="!text-left">
                      {/* Clicks here (the menu's portal included) stay off the row, which opens the list. */}
                      <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        {step === "fix" && fix && cleanHref && (
                          // Fixed on the Clean step, not here (owner 2026-10-29): it lands on its List problems.
                          <Button asChild type="button" variant="outline" size="sm" className={STEP_BUTTON}>
                            <Link href={`${cleanHref}#list-problems`} title={`${fix} · fix it in Clean`} aria-label={`Fix in Clean: ${fix}`}>
                              <Wrench aria-hidden="true" />Fix in Clean
                            </Link>
                          </Button>
                        )}
                        {step === "blocked" && (
                          // The Clean gate turns this person away: the reason, not a button they cannot use.
                          <span className={cn(STEP_BUTTON, "inline-flex h-8 items-center truncate px-2.5 text-xs text-[var(--muted)]")} title={detail}>
                            {list.scrubStatus === "failed" ? "Scrub failed" : "Not scrubbed"}
                          </span>
                        )}
                        {step === "import" && (
                          // Nothing arrived yet: its file is the next move (Import opens with this list chosen).
                          <Button asChild type="button" variant="outline" size="sm" className={STEP_BUTTON}>
                            <Link href={importHref} aria-label={`Import a file into ${list.campaignName}`}>
                              <Upload aria-hidden="true" />Import
                            </Link>
                          </Button>
                        )}
                        {step === "assign" && solo && (
                          <Button asChild type="button" variant="outline" size="sm" className={STEP_BUTTON}>
                            <Link href={DIALER_HREF} title={urgent ? `Do this first · call ${list.campaignName}'s leads` : `Call ${list.campaignName}'s leads`} aria-label={`Call now: ${list.campaignName}${urgent ? " (do this first)" : ""}`}>
                              <PhoneCall aria-hidden="true" className={urgent ? "text-[var(--accent-ink)]" : undefined} />Call now
                            </Link>
                          </Button>
                        )}
                        {step === "recycle" && (
                          <Button asChild type="button" variant="outline" size="sm" className={STEP_BUTTON}>
                            <Link href={RECYCLE_HREF} title={`Bring ${list.campaignName}'s worked leads back in Recycle`} aria-label={`Recycle: ${list.campaignName}`}>
                              <Recycle aria-hidden="true" />Recycle
                            </Link>
                          </Button>
                        )}
                        {action && (
                          <Button
                            type="button"
                            variant={step === "open" ? "ghost" : "outline"}
                            size="sm"
                            className={STEP_BUTTON}
                            title={urgent ? `Do this first · ${action.title}` : action.title}
                            aria-label={`${action.label}: ${list.campaignName}${urgent ? " (do this first)" : ""}`}
                            onClick={() => onOpen(list, action.tab, action.intent)}
                          >
                            <action.Icon aria-hidden="true" className={urgent ? "text-[var(--accent-ink)]" : undefined} />
                            {action.label}
                          </Button>
                        )}
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={`More for ${list.campaignName}`} title="More">
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {more.map((item) => (
                              <DropdownMenuItem key={item.label} onSelect={() => onOpen(list, item.tab, item.intent)}>
                                <item.Icon aria-hidden="true" />{item.label === "Open" ? "Open list" : item.label}
                              </DropdownMenuItem>
                            ))}
                            {step !== "import" && (
                              <DropdownMenuItem asChild>
                                <Link href={importHref}><Upload aria-hidden="true" />Import a file</Link>
                              </DropdownMenuItem>
                            )}
                            {/* Delete only an empty list, for the people who may (the server refuses one with history). */}
                            {state === "empty" && canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" disabled={deleting !== null} onSelect={() => void removeEmpty(list)}>
                                  <Trash2 aria-hidden="true" />Delete list
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
      </div>
    </div>
  );
}
