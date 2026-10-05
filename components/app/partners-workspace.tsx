"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";
import {
  Archive,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Download,
  Edit3,
  Info,
  MapPin,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";

import { AffiliateLinksPanel } from "@/components/app/affiliate-links-panel";
import { PartnerUsersPanel } from "@/components/app/partner-users-panel";
import { PartnerFormStudio } from "@/components/app/partner-form-studio";
import { PartnerMarketAccessPanel } from "@/components/app/partner-market-access-panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PARTNER_PAYOUT_MODEL_LABELS,
  PARTNER_PAYOUT_MODELS,
  PARTNER_STATUS_LABELS,
  PARTNER_TYPE_LABELS,
  PARTNER_TYPES,
  type PartnerPayoutModel,
  type PartnerStatus,
  type PartnerType,
} from "@/lib/partners/constants";
import { PageHeader } from "@/components/ui/page-header";
import { PartnerOnboarding } from "@/components/app/partner-onboarding";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { PageLoading } from "@/components/ui/page-loading";
import { TableCard } from "@/components/ui/table-card";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { NoMatches } from "@/components/ui/page-states";
import { productLineLabel } from "@/lib/format/productLine";
import { PARTNER_LIMIT_KEYS, capacityLabel } from "@/lib/partners/limits";
import { partnerLimitMessage } from "@/lib/partnerLimits/copy";
import { cn } from "@/lib/utils";

type Term = {
  id: string;
  partner_id: string;
  payout_model: PartnerPayoutModel;
  rate_cents: number | null;
  rate_pct_bp: number | null;
  effective_from: string;
  created_at: string;
};
type Partner = {
  id: string;
  name: string;
  partner_type: PartnerType;
  status: PartnerStatus;
  country: string;
  contact_name: string | null;
  contact_email: string | null;
  timezone: string;
  notes: string | null;
  terms: Term[];
  active_term: Term | null;
  lead_volume_this_month: number;
  last_submission: string | null;
  active_user_count: number;
  offboarded_at?: string | null;
  transfers_this_month: number;
  completed_this_month: number;
  dropped_this_month: number;
  approved_products: string[];
};
type CapacityLimits = {
  max_publishers: number | null;
  max_marketing_partners: number | null;
  max_affiliates: number | null;
  max_buffer_seats: number | null;
  max_partner_users: number | null;
};
type CapacityUsage = {
  publishers: number;
  marketing: number;
  affiliates: number;
  partnerUsers: number;
};
type Product = {
  code: string;
  name: string;
  category: string;
  is_enabled: boolean;
  sort_order: number;
};
type PartnerProduct = Product & { approved: boolean };
type PartnerDraft = {
  name: string;
  partner_type: PartnerType;
  country: string;
  contact_name: string;
  contact_email: string;
  timezone: string;
  notes: string;
};
type DetailTab =
  "overview" | "terms" | "products" | "markets" | "forms" | "team" | "activity";

// The board's strip: Overview, Team, Products, Forms, Commercial terms, then More.
const primaryDetailTabs: DetailTab[] = [
  "overview",
  "team",
  "products",
  "forms",
  "terms",
];
const secondaryDetailTabs: DetailTab[] = ["markets", "activity"];

const detailTabLabel = (tab: DetailTab) =>
  tab === "markets"
    ? "Carrier & states"
    : tab === "terms"
      ? "Commercial terms"
      : tab.charAt(0).toUpperCase() + tab.slice(1);

const STATUS_CHIP: Record<PartnerStatus, string> = {
  active: "bg-[var(--success-surface)] text-[var(--success-ink)]",
  draft: "bg-[var(--info-surface)] text-[var(--info-ink)]",
  paused: "bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  offboarded: "bg-[var(--surface-alt)] text-[var(--body)]",
};

function PartnerFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">{children}</div>
    </div>
  );
}

function ProductChip({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold", on ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>
      <span className={cn("size-1.5 rounded-full", on ? "bg-[var(--success)]" : "bg-[var(--muted-foreground)]")} aria-hidden="true" />
      {on ? onLabel : offLabel}
    </span>
  );
}

const emptyDraft: PartnerDraft = {
  name: "",
  partner_type: "publisher",
  country: "US",
  contact_name: "",
  contact_email: "",
  timezone: "UTC",
  notes: "",
};
// Keep server and browser markup identical. The publisher page is rendered on the
// server before the client takes over, so locale/timezone-sensitive formatters and
// a current-date default can otherwise trigger a hydration mismatch.
// "13 Jun 2026", as the partner boards date things — built by hand, in UTC, for the same reason.
const DATE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (value: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : `${date.getUTCDate()} ${DATE_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};
const money = (cents: number | null) =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
/** "Per transfer · $28.00", "12.50% revenue share", or "No terms" — what the partner is paid. */
const termText = (term: Term | null) =>
  !term
    ? "No terms"
    : term.payout_model === "revenue_share"
      ? `${((term.rate_pct_bp ?? 0) / 100).toFixed(2)}% revenue share`
      : `${PARTNER_PAYOUT_MODEL_LABELS[term.payout_model]} · ${money(term.rate_cents)}`;
/** The first commercial terms ever recorded: when the relationship started paying. */
const earliestTerm = (partner: Partner) =>
  partner.terms.reduce<string | null>((min, term) => (!min || term.effective_from < min ? term.effective_from : min), null);
const statusTone = (status: PartnerStatus) =>
  status === "active" ? "good" : status === "paused" ? "warning" : "neutral";

function CapacityMetric({
  label,
  noun,
  usage,
  limit,
  activeOnly = true,
}: {
  label: string;
  noun: string;
  usage: number;
  limit: number | null;
  activeOnly?: boolean;
}) {
  const percent =
    limit == null
      ? 0
      : Math.min(100, limit === 0 ? 100 : (usage / limit) * 100);
  // Said before the ceiling is hit, in the same count the server enforces: only an ACTIVE partner
  // holds a slot (LA-1.19). Drafts, paused and offboarded partners do not.
  return (
    <StatTile
      label={label}
      value={usage}
      meter={{ value: percent, tone: "info", label: `${label} capacity used` }}
      footnote={`${capacityLabel(usage, limit, usage === 1 && limit == null ? noun.replace(/s$/, "") : noun)}${activeOnly && limit != null ? " · active only" : ""}`}
    />
  );
}

export function PartnersWorkspace({
  readOnly,
  canManageProductConfig = false,
  initialSelectedId = null,
  detailOnly = false,
}: {
  readOnly: boolean;
  canManageProductConfig?: boolean;
  initialSelectedId?: string | null;
  detailOnly?: boolean;
}) {
  const router = useRouter();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [draft, setDraft] = useState<PartnerDraft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [termFor, setTermFor] = useState<string | null>(null);
  const [termModel, setTermModel] =
    useState<PartnerPayoutModel>("per_transfer");
  const [termRate, setTermRate] = useState("");
  const [termDate, setTermDate] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerProducts, setPartnerProducts] = useState<
    Record<string, PartnerProduct[]>
  >({});
  const [limits, setLimits] = useState<CapacityLimits>({
    max_publishers: null,
    max_marketing_partners: null,
    max_affiliates: null,
    max_buffer_seats: null,
    max_partner_users: null,
  });
  const [usage, setUsage] = useState<CapacityUsage>({
    publishers: 0,
    marketing: 0,
    affiliates: 0,
    partnerUsers: 0,
  });
  const [selectedId, setSelectedIdState] = useState<string | null>(initialSelectedId);
  const setSelectedId = (
    value: string | null | ((current: string | null) => string | null),
  ) =>
    setSelectedIdState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      return typeof value === "string" && current === value ? null : next;
    });
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PartnerType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PartnerStatus>(
    "all",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [offboardFor, setOffboardFor] = useState<Partner | null>(null);
  const [offboardText, setOffboardText] = useState("");

  // After the first load, a reload (Refresh, or the re-read after every write) keeps the page drawn:
  // swapping it for the page skeleton unmounted the detail panels and lost their unsaved edits.
  const hasLoaded = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);
    try {
      const [response, productResponse] = await Promise.all([
        fetch("/api/app/partners", { cache: "no-store" }),
        canManageProductConfig
          ? fetch("/api/app/products", { cache: "no-store" })
          : Promise.resolve(null),
      ]);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not load partners");
        return;
      }
      const loadedPartners = body.partners ?? [];
      setPartners(loadedPartners);
      setSelectedId((current) =>
        current &&
        loadedPartners.some((partner: Partner) => partner.id === current)
          ? current
          : null,
      );
      setLimits({
        max_publishers: body.limits?.max_publishers ?? null,
        max_marketing_partners: body.limits?.max_marketing_partners ?? null,
        max_affiliates: body.limits?.max_affiliates ?? null,
        max_buffer_seats: body.limits?.max_buffer_seats ?? null,
        max_partner_users: body.limits?.max_partner_users ?? null,
      });
      setUsage(
        body.usage ?? {
          publishers: 0,
          marketing: 0,
          affiliates: 0,
          partnerUsers: 0,
        },
      );
      if (canManageProductConfig && productResponse) {
        const productBody = await productResponse.json().catch(() => null);
        if (productResponse.ok) setProducts(productBody.products ?? []);
        const configs = await Promise.all(
          loadedPartners.map(async (partner: Partner) => {
            const result = await fetch(
              `/api/app/partners/${partner.id}/products`,
              { cache: "no-store" },
            );
            const resultBody = await result.json().catch(() => null);
            return [
              partner.id,
              result.ok ? (resultBody.products ?? []) : [],
            ] as const;
          }),
        );
        setPartnerProducts(Object.fromEntries(configs));
      }
    } catch (reason) {
      notify.fail(
        reason instanceof Error ? reason.message : "Could not load partners",
      );
    } finally {
      hasLoaded.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [canManageProductConfig]);

  // After a Team-tab invite or status change: re-read the seat figures (and each partner's user
  // count) without the product fan-out `load` does and without redrawing the page.
  const refreshCapacity = useCallback(async () => {
    try {
      const response = await fetch("/api/app/partners", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) return;
      if (Array.isArray(body.partners)) setPartners(body.partners);
      if (body.limits) setLimits((current) => ({ ...current, max_partner_users: body.limits.max_partner_users ?? null }));
      if (body.usage) setUsage(body.usage);
    } catch {
      // The panel already re-read its own rows; stale seat figures correct on the next page load.
    }
  }, []);

  // The API is the source of truth; refresh after every write so status and effective terms are
  // visible immediately without requiring a re-login or a full page refresh.
  useEffect(() => {
    // Initial client hydration fetch; load owns the corresponding loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function send(
    path: string,
    method: "POST" | "PATCH" | "PUT",
    body: Record<string, unknown>,
    success: string,
  ) {
    setBusy(path);
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(result?.error ?? "Could not save changes");
        return false;
      }
      notify.done(success);
      await load();
      return true;
    } catch (reason) {
      notify.fail(
        reason instanceof Error ? reason.message : "Could not save changes",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function toggleTenantProduct(product: Product) {
    await send(
      `/api/app/products/${encodeURIComponent(product.code)}`,
      "PATCH",
      { is_enabled: !product.is_enabled },
      `${product.name} ${product.is_enabled ? "disabled" : "enabled"}`,
    );
  }
  async function togglePartnerProduct(
    partnerId: string,
    product: PartnerProduct,
  ) {
    await send(
      `/api/app/partners/${partnerId}/products`,
      "PUT",
      { product_code: product.code, approved: !product.approved },
      `${product.name} ${product.approved ? "approval removed" : "approved"}`,
    );
  }
  async function savePartner(event: FormEvent) {
    event.preventDefault();
    const path = editing ? `/api/app/partners/${editing}` : "/api/app/partners";
    const ok = await send(
      path,
      editing ? "PATCH" : "POST",
      editing ? { action: "update", ...draft } : draft,
      editing ? "Partner updated" : "Partner created",
    );
    if (ok) {
      setDraft(emptyDraft);
      setEditing(null);
      setDialogOpen(false);
    }
  }
  // Offboarding is typed, not clicked: the first call opens the dialog, and only the dialog's
  // confirm — with OFFBOARD typed exactly — sends it. The server checks the word again.
  async function changeStatus(partner: Partner, nextStatus: PartnerStatus, confirmation?: string) {
    if (nextStatus === "offboarded" && confirmation !== "OFFBOARD") {
      setOffboardText("");
      setOffboardFor(partner);
      return;
    }
    await send(
      `/api/app/partners/${partner.id}`,
      "PATCH",
      {
        action: "transition",
        next_status: nextStatus,
        reason:
          nextStatus === "paused"
            ? "Partner paused from partner records"
            : nextStatus === "offboarded"
              ? "Partner offboarded from partner records"
              : "Partner returned to active status",
        confirmation,
      },
      `Partner ${PARTNER_STATUS_LABELS[nextStatus].toLowerCase()}`,
    );
  }
  async function saveTerm(event: FormEvent, partnerId: string) {
    event.preventDefault();
    const numericRate = Number(termRate);
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      notify.block("Enter a valid non-negative rate");
      return;
    }
    const body =
      termModel === "revenue_share"
        ? {
            action: "add_term",
            payout_model: termModel,
            rate_cents: null,
            rate_pct_bp: Math.round(numericRate * 100),
            effective_from: termDate,
          }
        : {
            action: "add_term",
            payout_model: termModel,
            rate_cents: Math.round(numericRate * 100),
            rate_pct_bp: null,
            effective_from: termDate,
          };
    if (
      await send(
        `/api/app/partners/${partnerId}`,
        "PATCH",
        body,
        "Partner terms added",
      )
    ) {
      setTermFor(null);
      setTermRate("");
    }
  }
  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setDialogOpen(true);
  }
  function openEdit(partner: Partner) {
    setEditing(partner.id);
    setDraft({
      name: partner.name,
      partner_type: partner.partner_type,
      country: partner.country,
      contact_name: partner.contact_name ?? "",
      contact_email: partner.contact_email ?? "",
      timezone: partner.timezone,
      notes: partner.notes ?? "",
    });
    setDialogOpen(true);
  }

  const filteredPartners = useMemo(() => {
    const query = search.trim().toLowerCase();
    return partners.filter((partner) => {
      const matchesQuery =
        !query ||
        [
          partner.name,
          partner.contact_name,
          partner.contact_email,
          partner.country,
        ].some((value) => value?.toLowerCase().includes(query));
      return (
        matchesQuery &&
        (typeFilter === "all" || partner.partner_type === typeFilter) &&
        (statusFilter === "all" || partner.status === statusFilter)
      );
    });
  }, [partners, search, statusFilter, typeFilter]);
  const selectedPartner =
    partners.find((partner) => partner.id === selectedId) ?? null;
  const selectedProducts = selectedPartner
    ? (partnerProducts[selectedPartner.id] ?? [])
    : [];
  const selectedLimitKey = PARTNER_LIMIT_KEYS[draft.partner_type];
  const selectedUsage =
    usage[
      draft.partner_type === "publisher"
        ? "publishers"
        : draft.partner_type === "marketing"
          ? "marketing"
          : "affiliates"
    ];
  const selectedLimit = limits[selectedLimitKey];
  const createAtLimit =
    !editing && selectedLimit != null && selectedUsage >= selectedLimit;
  // With every partner type at its cap there is nothing the dialog could create.
  const everyTypeAtCap = (["publisher", "marketing", "affiliate"] as const).every((type) => {
    const cap = limits[PARTNER_LIMIT_KEYS[type]];
    return cap != null && usage[type === "publisher" ? "publishers" : type === "marketing" ? "marketing" : "affiliates"] >= cap;
  });

  if (loading) return <PageLoading />;

  return (
    <div className="m-stagger portal-partners-page flex flex-col gap-6 pb-6">
      {readOnly && (
        <div className="portal-partners-readonly rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-foreground">
          Your account is read-only. You can review partner records, but changes
          are unavailable until billing is restored.
        </div>
      )}
      {detailOnly ? (
        /* One partner, opened directly. The way back is a link above the title, as the artboard
           draws it, rather than a second button competing with the record's own actions. */
        <Link
          href="/app/publishers"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to partners
        </Link>
      ) : null}
      <PageHeader
        title={detailOnly ? (selectedPartner?.name ?? "Publisher details") : "Partners"}
        actions={
          detailOnly ? (
            selectedPartner ? (
              <>
                <Button type="button" variant="outline" onClick={() => openEdit(selectedPartner)} disabled={readOnly || selectedPartner.status === "offboarded"}>
                  <Edit3 data-icon="inline-start" aria-hidden="true" />Edit
                </Button>
                {!readOnly && selectedPartner.status !== "offboarded" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button">
                        <MoreHorizontal data-icon="inline-start" aria-hidden="true" />Actions<ChevronDown data-icon="inline-end" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuGroup>
                        {selectedPartner.status === "active" && <DropdownMenuItem onSelect={() => void changeStatus(selectedPartner, "paused")} disabled={busy !== null}><Pause aria-hidden="true" />Pause partner</DropdownMenuItem>}
                        {selectedPartner.status === "paused" && <DropdownMenuItem onSelect={() => void changeStatus(selectedPartner, "active")} disabled={busy !== null}><Play aria-hidden="true" />Resume partner</DropdownMenuItem>}
                        {selectedPartner.status === "draft" && <DropdownMenuItem onSelect={() => void changeStatus(selectedPartner, "active")} disabled={busy !== null}><Check aria-hidden="true" />Activate partner</DropdownMenuItem>}
                        {selectedPartner.status !== "draft" && <DropdownMenuItem variant="destructive" onSelect={() => void changeStatus(selectedPartner, "offboarded")} disabled={busy !== null}><Archive aria-hidden="true" />Offboard partner</DropdownMenuItem>}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            ) : undefined
          ) : (
            <>
              {/* A real link, not a button with a handler: the browser owns the download, so
                  middle-click and "Save link as" work, and a large directory does not have to be
                  held in memory first. Same pattern as the deal-flow export. */}
              <Button asChild type="button" variant="outline"><a href="/api/app/partners/export" download aria-label="Export the partner directory as CSV"><Download aria-hidden="true" />Export</a></Button>
              <Button type="button" onClick={openCreate} disabled={readOnly} title={everyTypeAtCap ? "Your plan's publisher, marketing partner and affiliate limits are all in use. Upgrade your plan to add another partner." : undefined}>
                <Plus aria-hidden="true" />
                Add partner
              </Button>
            </>
          )
        }
      />
      {!detailOnly && (
        <StatStrip label="Partner capacity" className="portal-partners-capacity">
          <CapacityMetric
            label="Publishers"
            noun="publishers"
            usage={usage.publishers}
            limit={limits.max_publishers}
          />
          <CapacityMetric
            label="Marketing"
            noun="marketing partners"
            usage={usage.marketing}
            limit={limits.max_marketing_partners}
          />
          <CapacityMetric
            label="Affiliates"
            noun="affiliates"
            usage={usage.affiliates}
            limit={limits.max_affiliates}
          />
          <CapacityMetric
            label="Partner users"
            noun="partner users"
            usage={usage.partnerUsers}
            limit={limits.max_partner_users}
            activeOnly={false}
          />
        </StatStrip>
      )}
      {!detailOnly && selectedPartner && (
        <div className="flex justify-end lg:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedId(null)}
          >
            <X className="mr-1.5 size-4" aria-hidden="true" />
            Close details
          </Button>
        </div>
      )}
      <div
        className={cn(
          "portal-partners-master-detail grid gap-4 transition-[grid-template-columns] duration-300 ease-in-out",
          detailOnly
            ? "is-detail-only lg:grid-cols-1"
            : selectedPartner
            ? "is-selected lg:grid-cols-[minmax(220px,24%)_minmax(0,1fr)]"
            : "lg:grid-cols-1",
        )}
      >
        {!detailOnly && <TableCard
          className="min-w-0"
          toolbar={
            <DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={refreshing} />}>
              <ToolbarSearch value={search} onChange={setSearch} placeholder="Search partners" />
              <select
                aria-label="Filter by partner type"
                className={cn(toolbarControl, selectedPartner && "hidden")}
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
              >
                <option value="all">All types</option>
                {PARTNER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {PARTNER_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by partner status"
                className={cn(toolbarControl, selectedPartner && "hidden")}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              >
                <option value="all">All statuses</option>
                {(["draft", "active", "paused", "offboarded"] as PartnerStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {PARTNER_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </DataToolbar>
          }
        >
            {filteredPartners.length === 0 ? (
              <NoMatches noun="partners" onClear={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); }} />
            ) : (
              <div className="overflow-x-auto">
                <table
                  className={cn(
                    "w-full table-fixed text-left text-sm",
                    selectedPartner ? "min-w-0" : "min-w-[840px]",
                  )}
                >
                  <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th
                        className={cn(
                          "w-full px-4 py-3 font-medium",
                          selectedPartner && "px-2",
                        )}
                      >
                        Partner
                      </th>
                      <th
                        className={cn(
                          "px-4 py-3 font-medium",
                          selectedPartner && "hidden",
                        )}
                      >
                        Type
                      </th>
                      <th
                        className={cn(
                          "px-4 py-3 font-medium",
                          selectedPartner && "hidden",
                        )}
                      >
                        Approved for
                      </th>
                      <th
                        className={cn(
                          "px-4 py-3 font-medium",
                          selectedPartner && "hidden",
                        )}
                      >
                        Status
                      </th>
                      <th
                        className={cn(
                          "px-4 py-3 font-medium",
                          selectedPartner && "hidden",
                        )}
                      >
                        This month
                      </th>
                      <th
                        className={cn(
                          "px-4 py-3 font-medium",
                          selectedPartner && "hidden",
                        )}
                      >
                        Last submission
                      </th>
                      <th className="w-20 px-2 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredPartners.map((partner) => (
                      <tr
                        key={partner.id}
                        className={`transition-colors hover:bg-muted/30 ${selectedPartner?.id === partner.id ? "bg-[var(--color-blue-faint)]" : ""}`}
                      >
                        <td className="w-full px-4 py-3">
                          <button
                            type="button"
                            className={cn(
                              "flex w-full min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              selectedPartner && "gap-2",
                            )}
                            // One partner has one page (/app/publishers/[id]) — the same layout whether it
                            // was opened from here or from a link, so the two can never drift apart.
                            onClick={() => router.push(`/app/publishers/${partner.id}`)}
                          >
                            <span
                              className={cn(
                                "flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-blue-light)] text-sm font-semibold text-[var(--color-accent-ink)]",
                                selectedPartner && "size-8",
                              )}
                            >
                              {partner.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">
                                {partner.name}
                              </span>
                              <span
                                className={cn(
                                  "block truncate text-xs text-muted-foreground",
                                  selectedPartner && "hidden",
                                )}
                              >
                                {partner.contact_email || "No contact email"}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-muted-foreground",
                            selectedPartner && "hidden",
                          )}
                        >
                          {PARTNER_TYPE_LABELS[partner.partner_type]}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-muted-foreground",
                            selectedPartner && "hidden",
                          )}
                        >
                          <span className="line-clamp-2">
                            {partner.approved_products.length ? partner.approved_products.map(productLineLabel).join(" · ") : "Nothing yet"}
                          </span>
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3",
                            selectedPartner && "hidden",
                          )}
                        >
                          <StatusChip tone={statusTone(partner.status)}>
                            {PARTNER_STATUS_LABELS[partner.status]}
                          </StatusChip>
                          {partner.status === "offboarded" && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {partner.offboarded_at ? `${dateLabel(partner.offboarded_at)} · ` : ""}history kept
                            </span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3",
                            selectedPartner && "hidden",
                          )}
                        >
                          <span className="tabular-nums">{partner.transfers_this_month} {partner.transfers_this_month === 1 ? "transfer" : "transfers"}</span>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {partner.completed_this_month} completed · <span className={partner.transfers_this_month >= 10 && partner.dropped_this_month / partner.transfers_this_month >= 0.15 ? "font-semibold text-[var(--warning-ink)]" : undefined}>{partner.dropped_this_month} dropped</span>
                          </span>
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-4 py-3 text-muted-foreground",
                            selectedPartner && "hidden",
                          )}
                        >
                          {dateLabel(partner.last_submission)}
                        </td>
                        <td className="w-20 px-2 py-3 text-right">
                          {selectedPartner?.id === partner.id ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Close ${partner.name}`}
                              onClick={() => setSelectedId(null)}
                            >
                              Close
                            </Button>
                          ) : (
                            <Button asChild type="button" variant="outline" size="sm">
                              <Link href={`/app/publishers/${partner.id}`} aria-label={`View ${partner.name}`}>
                                View
                              </Link>
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              Showing {filteredPartners.length} of {partners.length} partner
              records
            </div>
        </TableCard>}
        {detailOnly && !selectedPartner && (
          <div className="rounded-lg border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            This partner is not in your workspace.{" "}
            <Link href="/app/publishers" className="font-semibold text-foreground underline-offset-4 hover:underline">Back to partners</Link>
          </div>
        )}
        {detailOnly && selectedPartner && (
          <div className="flex min-w-0 flex-col gap-6" aria-label={`${selectedPartner.name} details`}>
            <div className="flex flex-wrap gap-2">
              <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold", STATUS_CHIP[selectedPartner.status])}>
                <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
                {PARTNER_STATUS_LABELS[selectedPartner.status]}
              </span>
              <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--surface-alt)] px-2.5 py-[3px] text-xs font-semibold text-[var(--body)]">{PARTNER_TYPE_LABELS[selectedPartner.partner_type]}</span>
              <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--soft-orange-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--accent-ink)]">
                {selectedPartner.active_user_count} portal {selectedPartner.active_user_count === 1 ? "user" : "users"}
              </span>
            </div>

            <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-5">
                <PartnerFact label="Submitted">{selectedPartner.lead_volume_this_month.toLocaleString()} this month</PartnerFact>
                <PartnerFact label="Last submission">{dateLabel(selectedPartner.last_submission)}</PartnerFact>
                <PartnerFact label="Approved products">{selectedProducts.length ? `${selectedProducts.filter((product) => product.approved).length} of ${selectedProducts.length}` : "—"}</PartnerFact>
                <PartnerFact label="Pays">{termText(selectedPartner.active_term)}</PartnerFact>
                <PartnerFact label="Since">{earliestTerm(selectedPartner) ? dateLabel(earliestTerm(selectedPartner)) : "—"}</PartnerFact>
              </div>
            </section>

            <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
              <section className="min-w-0 flex-grow overflow-visible rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
                <nav className="flex flex-wrap items-center gap-x-6 border-b border-border px-5" aria-label="Partner detail sections">
                  {primaryDetailTabs.map((tab) => (
                    <button
                      type="button"
                      aria-current={detailTab === tab ? "page" : undefined}
                      key={tab}
                      onClick={() => setDetailTab(tab)}
                      className={cn(
                        "-mb-px h-10 shrink-0 border-b-2 px-1 text-sm font-semibold leading-[1.43] tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        detailTab === tab ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {detailTabLabel(tab)}
                    </button>
                  ))}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "-mb-px inline-flex h-10 items-center gap-1 border-b-2 px-1 text-sm font-semibold leading-[1.43] tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          secondaryDetailTabs.includes(detailTab) ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {secondaryDetailTabs.includes(detailTab) ? detailTabLabel(detailTab) : "More"}
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuGroup>
                        {secondaryDetailTabs.map((tab) => (
                          <DropdownMenuItem key={tab} aria-current={detailTab === tab ? "page" : undefined} onSelect={() => setDetailTab(tab)} className={cn(detailTab === tab && "font-semibold")}>
                            {detailTabLabel(tab)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </nav>
            <div className="space-y-5 p-5">
              {detailTab === "overview" && (
                <div className="space-y-5">
                  <PartnerOnboarding
                    partnerId={selectedPartner.id}
                    hasTerm={Boolean(selectedPartner.active_term)}
                    termText={termText(selectedPartner.active_term)}
                    approved={partnerProducts[selectedPartner.id] ? { count: selectedProducts.filter((product) => product.approved).length, total: selectedProducts.length } : null}
                    lastSubmission={selectedPartner.last_submission}
                  />
                  <section>
                    <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Products this partner may submit</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Enable for the business first, then approve the subset for this partner. The dependency is the design.</p>
                    {selectedProducts.length > 0 ? (
                      <div className="mt-3.5 overflow-x-auto">
                        <table className="portal-lead-table w-full min-w-[520px]! text-left text-sm">
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th className="w-[200px]">Enabled for the business</th>
                              <th className="w-[200px]">Approved for {selectedPartner.name}</th>
                            </tr>
                          </thead>
                          <tbody className="m-seq">
                            {selectedProducts.map((product) => (
                              <tr key={product.code} className="m-row">
                                <td>{product.name}</td>
                                <td><ProductChip on={product.is_enabled} onLabel="Enabled" offLabel="Not enabled" /></td>
                                <td>{product.is_enabled ? <ProductChip on={product.approved} onLabel="Approved" offLabel="Not approved" /> : <ProductChip on={false} onLabel="" offLabel="Unavailable" />}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                        {canManageProductConfig ? "No products are set up for this workspace yet." : "Product approvals are managed by the account owner."}
                      </p>
                    )}
                    {canManageProductConfig && !readOnly && selectedPartner.status !== "offboarded" && (
                      <Button type="button" variant="outline" size="sm" className="mt-3 h-8 border-[var(--border-strong)] px-3" onClick={() => setDetailTab("products")}>Change approvals</Button>
                    )}
                  </section>
                  <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
                    <p className="font-semibold text-[var(--error-ink)]">The lead form must keep its phone field</p>
                    <p className="mt-1.5 text-[var(--body)]">Phone is required for screening and cannot be deleted from a partner form. The studio refuses it, not just the API.</p>
                  </div>
                  <div className="grid gap-3">
                    <section className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Contact</h3>
                        {!readOnly &&
                          selectedPartner.status !== "offboarded" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => openEdit(selectedPartner)}
                            >
                              Edit
                            </Button>
                          )}
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        {selectedPartner.contact_name && (
                          <p className="font-medium">
                            {selectedPartner.contact_name}
                          </p>
                        )}
                        {selectedPartner.contact_email && (
                          <p className="break-all text-muted-foreground">
                            {selectedPartner.contact_email}
                          </p>
                        )}
                        <p className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden="true" />
                          {selectedPartner.country} · {selectedPartner.timezone}
                        </p>
                      </div>
                    </section>
                    <section className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Notes</h3>
                        {!readOnly &&
                          selectedPartner.status !== "offboarded" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => openEdit(selectedPartner)}
                            >
                              {selectedPartner.notes ? "Edit" : "Add"}
                            </Button>
                          )}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {selectedPartner.notes || "No notes added yet."}
                      </p>
                    </section>
                  </div>
                  {selectedPartner.partner_type === "affiliate" && (
                    <AffiliateLinksPanel
                      partnerId={selectedPartner.id}
                      readOnly={readOnly}
                    />
                  )}
                  <div className="rounded-lg border border-[var(--color-blue)]/25 bg-[var(--color-blue-faint)] p-3 text-sm">
                    <p className="flex items-start gap-2 font-medium">
                      <Info
                        className="mt-0.5 size-4 shrink-0 text-[var(--color-blue)]"
                        aria-hidden="true"
                      />
                      History is never deleted.
                    </p>
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">
                      Leads, submissions, terms, and partner-user history stay
                      available for audit and reporting.
                    </p>
                  </div>
                </div>
              )}
              {detailTab === "terms" && (
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Commercial terms
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        New rates apply from their effective date. Past leads
                        keep their original terms.
                      </p>
                    </div>
                    {!readOnly && selectedPartner.status !== "offboarded" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTermDate(new Date().toISOString().slice(0, 10));
                          setTermFor(
                            termFor === selectedPartner.id
                              ? null
                              : selectedPartner.id,
                          );
                        }}
                      >
                        Add terms
                      </Button>
                    )}
                  </div>
                  {selectedPartner.terms.length > 0 ? (
                    <div className="divide-y rounded-lg border">
                      {selectedPartner.terms.map((term, index) => (
                        <div
                          key={term.id}
                          className={`p-3 text-sm ${index === 0 ? "bg-[var(--color-blue-faint)]" : ""}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">
                              {term.payout_model === "revenue_share"
                                ? `${((term.rate_pct_bp ?? 0) / 100).toFixed(2)}% revenue share`
                                : `${PARTNER_PAYOUT_MODEL_LABELS[term.payout_model]} · ${money(term.rate_cents)}`}
                            </span>
                            {index === 0 && (
                              <StatusChip tone="info">Current</StatusChip>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Effective {dateLabel(term.effective_from)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No commercial terms recorded yet.
                    </p>
                  )}
                  {termFor === selectedPartner.id &&
                    !readOnly &&
                    selectedPartner.status !== "offboarded" && (
                      <form
                        onSubmit={(event) =>
                          void saveTerm(event, selectedPartner.id)
                        }
                        className="space-y-3 rounded-lg border bg-muted/20 p-3"
                      >
                        <div className="space-y-1.5">
                          <Label htmlFor={`term-model-${selectedPartner.id}`}>
                            Payout model
                          </Label>
                          <select
                            id={`term-model-${selectedPartner.id}`}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                            value={termModel}
                            onChange={(event) =>
                              setTermModel(
                                event.target.value as PartnerPayoutModel,
                              )
                            }
                          >
                            {PARTNER_PAYOUT_MODELS.map((model) => (
                              <option key={model} value={model}>
                                {PARTNER_PAYOUT_MODEL_LABELS[model]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`term-rate-${selectedPartner.id}`}>
                              {termModel === "revenue_share"
                                ? "Share (%)"
                                : "Rate ($)"}
                            </Label>
                            <Input
                              id={`term-rate-${selectedPartner.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={termRate}
                              onChange={(event) =>
                                setTermRate(event.target.value)
                              }
                              required
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`term-date-${selectedPartner.id}`}>
                              Effective from
                            </Label>
                            <Input
                              id={`term-date-${selectedPartner.id}`}
                              type="date"
                              value={termDate}
                              onChange={(event) =>
                                setTermDate(event.target.value)
                              }
                              required
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            size="sm"
                            disabled={busy !== null}
                          >
                            Save terms
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setTermFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}
                </section>
              )}
              {detailTab === "products" && (
                <section className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Products you sell
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Enable a product for the business, then approve the subset
                      this partner may submit.
                    </p>
                  </div>
                  {canManageProductConfig ? (
                    <div className="space-y-2">
                      {products.map((product) => (
                        <label
                          key={product.code}
                          className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4"
                            checked={product.is_enabled}
                            disabled={readOnly || busy !== null}
                            onChange={() => void toggleTenantProduct(product)}
                          />
                          <span>
                            <span className="block font-medium">
                              {product.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {product.category} · {product.code}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      Product availability is managed by the account owner.
                    </p>
                  )}
                  {canManageProductConfig && (
                    <div className="border-t pt-4">
                      <h3 className="text-sm font-semibold">
                        Approved for this partner
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Only enabled products can be approved.
                      </p>
                      <div className="mt-3 space-y-2">
                        {selectedProducts.map((product) => (
                          <label
                            key={product.code}
                            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${!product.is_enabled ? "opacity-50" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={product.approved}
                              disabled={
                                readOnly ||
                                !product.is_enabled ||
                                busy !== null ||
                                selectedPartner.status === "offboarded"
                              }
                              onChange={() =>
                                void togglePartnerProduct(
                                  selectedPartner.id,
                                  product,
                                )
                              }
                            />
                            <span>{product.name}</span>
                            {!product.is_enabled && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                Business disabled
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
              {detailTab === "markets" && (
                <PartnerMarketAccessPanel
                  partnerId={selectedPartner.id}
                  readOnly={readOnly || selectedPartner.status === "offboarded"}
                />
              )}
              {detailTab === "forms" && (
                <PartnerFormStudio
                  partnerId={selectedPartner.id}
                  readOnly={readOnly || selectedPartner.status === "offboarded"}
                />
              )}
              {detailTab === "team" && (
                <PartnerUsersPanel
                  key={selectedPartner.id}
                  partnerId={selectedPartner.id}
                  readOnly={readOnly}
                  offboarded={selectedPartner.status === "offboarded"}
                  // The admin-assignment route is owner-only; this page's owner flag is the same check.
                  canAssignAdmin={canManageProductConfig}
                  seatUsage={usage.partnerUsers}
                  seatLimit={limits.max_partner_users}
                  onSeatsChanged={() => void refreshCapacity()}
                />
              )}
              {detailTab === "activity" && (
                <section className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">Partner activity</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Every lifecycle change, terms update, invitation, and
                      access change is audit-logged.
                    </p>
                  </div>
                  <div className="rounded-lg border border-dashed p-4 text-sm">
                    <p className="font-medium">Preserved operational history</p>
                    {/* This used to link to /app/audit-log, which is not a route — the agent plane
                        has no audit-log viewer, so the link rendered a 404 inside the shell. The
                        events are still recorded; what is missing is a screen for them. Naming
                        only what can actually be opened is the honest version. */}
                    <p className="mt-1 text-muted-foreground">
                      Every change is recorded and kept. Review the leads
                      connected to this partner in the lead workspace; the
                      audit trail itself is available to your account
                      administrator.
                    </p>
                    <Button asChild variant="link" className="mt-2 h-auto p-0">
                      <Link href="/app/leads">
                        <ArrowRight
                          className="mr-1.5 size-3.5"
                          aria-hidden="true"
                        />
                        Open lead workspace
                      </Link>
                    </Button>
                  </div>
                </section>
              )}
            </div>
              </section>

              <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[360px]">
                <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
                  <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Commercial terms</h2>
                  {selectedPartner.active_term ? (
                    <div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4">
                      <PartnerFact label="Model">{PARTNER_PAYOUT_MODEL_LABELS[selectedPartner.active_term.payout_model]}</PartnerFact>
                      <PartnerFact label="Rate">{selectedPartner.active_term.payout_model === "revenue_share" ? `${((selectedPartner.active_term.rate_pct_bp ?? 0) / 100).toFixed(2)}%` : money(selectedPartner.active_term.rate_cents)}</PartnerFact>
                      <PartnerFact label="Effective">{dateLabel(selectedPartner.active_term.effective_from)}</PartnerFact>
                      <PartnerFact label="Earlier terms">{Math.max(0, selectedPartner.terms.length - 1)}</PartnerFact>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No commercial terms are recorded yet.</p>
                  )}
                  <Button type="button" variant="outline" size="sm" className="mt-3.5 h-9 border-[var(--border-strong)] px-4" onClick={() => setDetailTab("terms")}>
                    {selectedPartner.active_term ? "Terms history" : "Add terms"}
                  </Button>
                </section>
                <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
                  <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Form studio</h2>
                  <p className="mt-2.5 text-sm text-muted-foreground">New partner forms use the published revision immediately; forms already submitted keep the revision they were filled on. Inherited defaults can be restored per product inside the studio.</p>
                  <Button type="button" variant="outline" size="sm" className="mt-3.5 h-9 border-[var(--border-strong)] px-4" onClick={() => setDetailTab("forms")}>Open studio</Button>
                </section>
                <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
                  <p className="font-semibold text-[var(--warning-ink)]">Offboarding is typed, not clicked</p>
                  <p className="mt-1.5 text-[var(--body)]">It asks for <strong>OFFBOARD</strong> exactly, and the record survives: records and users remain visible for audit and reporting. No data is ever permanently deleted.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <Dialog open={offboardFor !== null} onOpenChange={(open) => { if (!open) setOffboardFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Offboard {offboardFor?.name}</DialogTitle>
            <DialogDescription>
              This permanently revokes the partner&rsquo;s portal users. The record, its leads, terms and users stay visible for audit and reporting; nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!offboardFor || offboardText !== "OFFBOARD") return;
              const partner = offboardFor;
              setOffboardFor(null);
              void changeStatus(partner, "offboarded", offboardText);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="offboard-confirm">Type OFFBOARD to confirm</Label>
              <Input id="offboard-confirm" autoComplete="off" value={offboardText} onChange={(event) => setOffboardText(event.target.value)} placeholder="OFFBOARD" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOffboardFor(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={offboardText !== "OFFBOARD" || busy !== null}>Offboard partner</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit partner" : "Add a partner"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the record without changing its preserved history."
                : "Create one record for a publisher, marketing company, or affiliate."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePartner} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="partner-name">Partner name</Label>
              <Input
                id="partner-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Apex Call Center"
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-type">Type</Label>
              <select
                id="partner-type"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={draft.partner_type}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    partner_type: event.target.value as PartnerType,
                  })
                }
              >
                {PARTNER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {PARTNER_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-country">Country</Label>
              <Input
                id="partner-country"
                value={draft.country}
                onChange={(event) =>
                  setDraft({ ...draft, country: event.target.value })
                }
                placeholder="US"
                required
                maxLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-contact">Contact name</Label>
              <Input
                id="partner-contact"
                value={draft.contact_name}
                onChange={(event) =>
                  setDraft({ ...draft, contact_name: event.target.value })
                }
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-email">Contact email</Label>
              <Input
                id="partner-email"
                type="email"
                value={draft.contact_email}
                onChange={(event) =>
                  setDraft({ ...draft, contact_email: event.target.value })
                }
                placeholder="ops@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-timezone">Timezone</Label>
              <Input
                id="partner-timezone"
                value={draft.timezone}
                onChange={(event) =>
                  setDraft({ ...draft, timezone: event.target.value })
                }
                placeholder="America/Phoenix"
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="partner-notes">Notes</Label>
              <textarea
                id="partner-notes"
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
                maxLength={5000}
              />
            </div>
            {createAtLimit && (
              <p
                className="text-sm text-destructive md:col-span-2"
                role="alert"
              >
                {partnerLimitMessage(selectedLimitKey, selectedUsage, selectedLimit ?? 0, "add")}
              </p>
            )}
            <DialogFooter className="md:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy !== null || createAtLimit}>
                {busy ? "Saving…" : editing ? "Save partner" : "Create partner"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
