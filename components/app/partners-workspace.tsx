"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
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
  MapPin,
  MessagesSquare,
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
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
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
import { Ring } from "@/components/app/inbound/stream-parts";
import { PageLoading } from "@/components/ui/page-loading";
import { TableCard } from "@/components/ui/table-card";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { FILL_CARD, useFittingRows } from "@/components/app/use-fitting-rows";
import { productLineLabel } from "@/lib/format/productLine";
import { PARTNER_LIMIT_KEYS, capacityLabel } from "@/lib/partners/limits";
import { partnerLimitMessage } from "@/lib/partnerLimits/copy";
import { cn } from "@/lib/utils";
import { UnderlineTabs } from "@/components/ui/view-tabs";

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
  "overview" | "terms" | "products" | "markets" | "forms" | "team" | "activity" | PartnerExtraTab;

/**
 * Module 1 simplified (2026-10-25): one partner's quality and payout runs used to be pages of their
 * own; they are sections of the record's Overview now, with its users (Partner record B, chosen
 * 2026-10-25). Each keeps its own feature and role gate: the record page passes in only the
 * sections this person may see. Chat is not here: it stays in Partner chat, and the record's
 * Message button opens this partner's conversation there.
 */
export type PartnerExtraTab = "quality" | "payouts";

// Overview is one scroll (figures, quality, money, people, products, contact); the set-up sections
// keep their tabs. Old links to ?tab=quality / payouts / team land on Overview at that section.
const detailTabs: DetailTab[] = [
  "overview",
  "products",
  "forms",
  "terms",
  "markets",
  "activity",
];
const OVERVIEW_SECTIONS = ["quality", "payouts", "team"] as const;

const detailTabLabel = (tab: DetailTab) =>
  tab === "team"
    ? "Users"
    : tab === "markets"
    ? "Carrier & states"
    : tab === "terms"
      ? "Commercial terms"
      : tab.charAt(0).toUpperCase() + tab.slice(1);

const STATUS_TONE: Record<PartnerStatus, StatusTone> = {
  active: "good",
  draft: "info",
  paused: "warning",
  offboarded: "neutral",
};

function PartnerFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">{children}</div>
    </div>
  );
}

/** Whether a product is open to the partner, as the shared chip (foundation v3). */
function ProductChip({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return <StatusChip tone={on ? "good" : "neutral"} dot>{on ? onLabel : offLabel}</StatusChip>;
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
  // Partners A1 (2026-10-25): the plan's room as a ring, amber from four fifths full.
  return (
    <div className="m-glass rounded-xl border border-border flex min-w-0 items-center gap-3.5 px-4 py-3.5">
      <Ring value={percent / 100} tone={percent >= 80 ? "warning" : "success"} size={52} label={`${label} capacity used`}>{limit == null ? usage : `${usage}/${limit}`}</Ring>
      <div className="min-w-0">
        <p className="m-0 text-xs leading-[1.5] font-semibold tracking-[0.06em] uppercase text-muted-foreground">{label}</p>
        <p className="m-0 mt-0.5 text-xl leading-tight font-semibold tracking-[-0.02em] tabular-nums text-foreground">{limit == null ? usage : `${usage} of ${limit}`}</p>
        <p className="m-0 text-xs leading-[1.5] text-muted-foreground">{`${capacityLabel(usage, limit, usage === 1 && limit == null ? noun.replace(/s$/, "") : noun)}${activeOnly && limit != null ? " · active only" : ""}`}</p>
      </div>
    </div>
  );
}

export function PartnersWorkspace({
  readOnly,
  canManageProductConfig = false,
  initialSelectedId = null,
  detailOnly = false,
  extraTabs = {},
  initialTab = null,
  messageHref = null,
}: {
  readOnly: boolean;
  canManageProductConfig?: boolean;
  initialSelectedId?: string | null;
  detailOnly?: boolean;
  extraTabs?: Partial<Record<PartnerExtraTab, ReactNode>>;
  initialTab?: string | null;
  /** Partner chat, opened on this partner's conversation; null when this person has no Partner chat. */
  messageHref?: string | null;
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
  const [productsVersion, setProductsVersion] = useState(0);
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
  const shownTabs = detailTabs;
  const [detailTab, setDetailTab] = useState<DetailTab>(() => (shownTabs.find((tab) => tab === initialTab) ?? "overview"));
  // A link to one of Overview's sections (?tab=quality, the cross-partner lists) scrolls to it once,
  // as soon as the section has rendered (it waits on the partner's data), giving up after ~6 s.
  const overviewSection = OVERVIEW_SECTIONS.find((section) => section === initialTab) ?? null;
  useEffect(() => {
    if (!overviewSection) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const target = document.getElementById(`partner-section-${overviewSection}`);
      if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
      if (target || ++tries > 30) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, [overviewSection]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PartnerType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PartnerStatus>(
    "all",
  );
  const [listPage, setListPage] = useState(1);
  // Header, capacity strip, toolbar, column heads and pager around the directory's rows.
  const listPageSize = useFittingRows(400, 49);
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
        // Each partner's approved products are read when that partner is opened (the effect below),
        // not all at once here: the fan-out was one request per partner — 30-odd on a real book —
        // and the directory waited for every one before it drew. A reload forgets them, so the
        // open partner re-reads its own after every write.
        setPartnerProducts({});
        setProductsVersion((version) => version + 1);
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

  // The open partner's approved products: read on opening, and again after each reload.
  useEffect(() => {
    if (!canManageProductConfig || !selectedId || productsVersion === 0) return;
    let cancelled = false;
    void fetch(`/api/app/partners/${selectedId}/products`, { cache: "no-store" })
      .then(async (result) => ({ result, body: await result.json().catch(() => null) }))
      .then(({ result, body }) => {
        if (!cancelled) setPartnerProducts((current) => ({ ...current, [selectedId]: result.ok ? (body?.products ?? []) : [] }));
      })
      .catch(() => {
        if (!cancelled) setPartnerProducts((current) => ({ ...current, [selectedId]: [] }));
      });
    return () => {
      cancelled = true;
    };
  }, [canManageProductConfig, selectedId, productsVersion]);

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
  const { current: listCurrent, rows: listRows } = paginate(filteredPartners, listPage, listPageSize);
  const listFiltered = search.trim() !== "" || typeFilter !== "all" || statusFilter !== "all";
  const clearListFilters = () => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setListPage(1); };
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
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {readOnly && (
        <div role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
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
                {messageHref && (
                  <Button asChild type="button" variant="outline">
                    <Link href={messageHref}><MessagesSquare data-icon="inline-start" aria-hidden="true" />Message</Link>
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => openEdit(selectedPartner)} disabled={readOnly || selectedPartner.status === "offboarded"}>
                  <Edit3 data-icon="inline-start" aria-hidden="true" />Edit partner
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
              <Button data-guide="publisher-add" type="button" onClick={openCreate} disabled={readOnly} title={everyTypeAtCap ? "Your plan's publisher, marketing partner and affiliate limits are all in use. Upgrade your plan to add another partner." : undefined}>
                <Plus aria-hidden="true" />
                Add partner
              </Button>
            </>
          )
        }
      />
      {!detailOnly && (
        <section aria-label="Partner capacity" className="portal-partners-capacity grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        </section>
      )}
      {!detailOnly && selectedPartner && (
        <div className="flex justify-end lg:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSelectedId(null)}
          >
            <X aria-hidden="true" />
            Close details
          </Button>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-4">
        {!detailOnly && <TableCard
          className={`${FILL_CARD} min-h-[calc(100dvh-var(--top-bar-h)-260px)] min-w-0`}
          toolbar={
            <DataToolbar actions={<>
              {listFiltered && <ClearFiltersButton onClick={clearListFilters} />}
              <RefreshButton onClick={() => void load()} refreshing={refreshing} />
            </>}>
              <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setListPage(1); }} placeholder="Search partners" />
              <select
                aria-label="Filter by partner type"
                className={cn(toolbarControl, selectedPartner && "hidden")}
                value={typeFilter}
                onChange={(event) => { setTypeFilter(event.target.value as typeof typeFilter); setListPage(1); }}
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
                onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setListPage(1); }}
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
          footer={<Pager page={listCurrent} total={filteredPartners.length} pageSize={listPageSize} noun="partners" onPage={setListPage} suffix={`${partners.length} partner records in all`} />}
        >
            {partners.length === 0 && !listFiltered ? (
              <EmptyState title="No partners yet" hint="Add the publishers, marketing companies and affiliates who send you leads." action={readOnly ? undefined : <Button type="button" onClick={openCreate}><Plus aria-hidden="true" />Add partner</Button>} />
            ) : filteredPartners.length === 0 ? (
              <NoMatches noun="partners" onClear={clearListFilters} />
            ) : (
              <table className={cn("portal-lead-table w-full text-left text-sm", selectedPartner ? "min-w-0" : "min-w-[1080px]")}>
                <thead>
                  <tr>
                    <th>Partner</th>
                    {!selectedPartner && <th>Contact email</th>}
                    {!selectedPartner && <th>Type</th>}
                    {!selectedPartner && <th>Approved for</th>}
                    {!selectedPartner && <th>Status</th>}
                    {/* A live transfer is the publisher's word; marketing and affiliate partners send leads. */}
                    {!selectedPartner && (typeFilter === "publisher"
                      ? <th className="text-right" title="Transfers this month">Transfers (month)</th>
                      : <th className="text-right" title="Leads received this month">Leads (month)</th>)}
                    {!selectedPartner && <th className="text-right" title="Completed this month">Completed</th>}
                    {!selectedPartner && <th className="text-right" title="Dropped this month">Dropped</th>}
                    {!selectedPartner && <th>Last submission</th>}
                    <th className="text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {listRows.map((partner) => {
                    const products = partner.approved_products.length ? partner.approved_products.map(productLineLabel).join(" · ") : "Nothing yet";
                    const dropHeavy = partner.transfers_this_month >= 10 && partner.dropped_this_month / partner.transfers_this_month >= 0.15;
                    return (
                      <tr key={partner.id} className={cn("m-row", selectedPartner?.id === partner.id && "bg-[var(--primary-soft)]")}>
                        <td className="max-w-[260px]">
                          <button
                            type="button"
                            className="flex w-full min-w-0 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            // One partner has one page (/app/publishers/[id]) — the same layout whether it
                            // was opened from here or from a link, so the two can never drift apart.
                            onClick={() => router.push(`/app/publishers/${partner.id}`)}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)] text-xs font-semibold text-[var(--accent-ink)]" aria-hidden="true">
                              {partner.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="truncate font-semibold text-foreground" title={partner.name}>{partner.name}</span>
                          </button>
                        </td>
                        {!selectedPartner && <td className="max-w-[220px] truncate text-muted-foreground" title={partner.contact_email ?? undefined}>{partner.contact_email || "No contact email"}</td>}
                        {!selectedPartner && <td className="whitespace-nowrap text-muted-foreground">{PARTNER_TYPE_LABELS[partner.partner_type]}</td>}
                        {!selectedPartner && <td className="max-w-[220px] truncate text-muted-foreground" title={products}>{products}</td>}
                        {!selectedPartner && (
                          <td className="whitespace-nowrap">
                            <span className="inline-flex items-center gap-2">
                              <StatusChip tone={statusTone(partner.status)}>
                                {PARTNER_STATUS_LABELS[partner.status]}
                              </StatusChip>
                              {partner.status === "offboarded" && (
                                <span className="text-xs text-muted-foreground">
                                  {partner.offboarded_at ? `${dateLabel(partner.offboarded_at)} · ` : ""}history kept
                                </span>
                              )}
                            </span>
                          </td>
                        )}
                        {!selectedPartner && <td className="text-right tabular-nums">{partner.transfers_this_month}</td>}
                        {!selectedPartner && <td className="text-right tabular-nums">{partner.completed_this_month}</td>}
                        {!selectedPartner && (
                          <td className="tabular-nums">
                            <span className="flex items-center justify-end gap-2">
                              <span className={cn("w-8 text-right", dropHeavy && "font-semibold text-[var(--warning-ink)]")}>{partner.dropped_this_month}</span>
                              <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className={cn("block h-full rounded-full", dropHeavy ? "bg-[var(--warning)]" : "bg-[var(--muted-foreground)]")} style={{ width: `${partner.transfers_this_month ? Math.min(100, (partner.dropped_this_month / partner.transfers_this_month) * 300) : 0}%` }} /></span>
                            </span>
                          </td>
                        )}
                        {!selectedPartner && <td className="whitespace-nowrap text-muted-foreground">{dateLabel(partner.last_submission)}</td>}
                        <td className="text-right">
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
                    );
                  })}
                </tbody>
              </table>
            )}
        </TableCard>}
        {detailOnly && !selectedPartner && (
          <div className="rounded-lg border border-border bg-card">
            <EmptyState
              title="Partner not found"
              hint="This partner is not in your workspace."
              action={<Button asChild variant="outline"><Link href="/app/publishers">Back to partners</Link></Button>}
            />
          </div>
        )}
        {detailOnly && selectedPartner && (
          <div className="flex min-w-0 flex-col gap-6" aria-label={`${selectedPartner.name} details`}>
            {/* The key facts in one compact block (2026-10-06 redesign): state chips, then the figures. */}
            <section aria-label="Partner facts" className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <StatusChip tone={STATUS_TONE[selectedPartner.status]} dot>{PARTNER_STATUS_LABELS[selectedPartner.status]}</StatusChip>
                <StatusChip>{PARTNER_TYPE_LABELS[selectedPartner.partner_type]}</StatusChip>
                <StatusChip tone="action" dot={false}>
                  {selectedPartner.active_user_count} portal {selectedPartner.active_user_count === 1 ? "user" : "users"}
                </StatusChip>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <div className="m-glass rounded-xl border border-border px-3.5 py-3"><PartnerFact label="Submitted">{selectedPartner.lead_volume_this_month.toLocaleString()} this month</PartnerFact></div>
                <div className="m-glass rounded-xl border border-border px-3.5 py-3"><PartnerFact label="Last submission">{dateLabel(selectedPartner.last_submission)}</PartnerFact></div>
                <div className="m-glass rounded-xl border border-border px-3.5 py-3"><PartnerFact label="Approved products">{selectedProducts.length ? `${selectedProducts.filter((product) => product.approved).length} of ${selectedProducts.length}` : "—"}</PartnerFact></div>
                <div className="m-glass rounded-xl border border-border px-3.5 py-3"><PartnerFact label="Pays">{termText(selectedPartner.active_term)}</PartnerFact></div>
                <div className="m-glass rounded-xl border border-border px-3.5 py-3"><PartnerFact label="Since">{earliestTerm(selectedPartner) ? dateLabel(earliestTerm(selectedPartner)) : "—"}</PartnerFact></div>
              </div>
            </section>

            <div className="flex min-w-0 flex-col gap-6">
              <section className="m-glass rounded-xl border border-border min-w-0 overflow-visible">
                <UnderlineTabs label="Partner detail sections" className="px-5" tabs={shownTabs.map((tab) => ({ key: tab, label: detailTabLabel(tab) }))} value={detailTab} onChange={setDetailTab} idPrefix="partner-detail-tab" controls="partner-detail-view" />
            {/* The selected section, as the tab panel: it fades in when the tab changes (2026-10-09). */}
            <div key={detailTab} role="tabpanel" id="partner-detail-view" aria-labelledby={`partner-detail-tab-${detailTab}`} className="space-y-5 p-5">
              {detailTab === "overview" && (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
                <div className="min-w-0 space-y-5">
                  {extraTabs.quality && (
                    <section id="partner-section-quality" className="scroll-mt-24 space-y-3">
                      <h3 className="text-base font-semibold">Quality</h3>
                      {extraTabs.quality}
                    </section>
                  )}
                  {extraTabs.payouts && (
                    <section id="partner-section-payouts" className="scroll-mt-24 space-y-3">
                      <h3 className="text-base font-semibold">Money</h3>
                      {extraTabs.payouts}
                    </section>
                  )}
                  <section id="partner-section-team" className="scroll-mt-24 space-y-3">
                    <h3 className="text-base font-semibold">People</h3>
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
                  </section>
                  {/* Compliance: the screening dependency, said once and kept visible. */}
                  <p role="note" className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--body)]">
                    <strong className="font-semibold text-[var(--error-ink)]">The lead form must keep its phone field.</strong> Phone is required for screening and cannot be deleted from a partner form.
                  </p>
                </div>
                <div className="min-w-0 space-y-5">
                  <PartnerOnboarding
                    partnerId={selectedPartner.id}
                    hasTerm={Boolean(selectedPartner.active_term)}
                    termText={termText(selectedPartner.active_term)}
                    approved={partnerProducts[selectedPartner.id] ? { count: selectedProducts.filter((product) => product.approved).length, total: selectedProducts.length } : null}
                    lastSubmission={selectedPartner.last_submission}
                  />
                  <section>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-base font-semibold">Products this partner may submit</h3>
                      {canManageProductConfig && !readOnly && selectedPartner.status !== "offboarded" && (
                        <Button type="button" variant="outline" onClick={() => setDetailTab("products")}>Change approvals</Button>
                      )}
                    </div>
                    {selectedProducts.length > 0 ? (
                      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                        <table className="portal-lead-table w-full min-w-0! text-left text-sm">
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th>Enabled for the business</th>
                              <th>Approved for {selectedPartner.name}</th>
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
                      canManageProductConfig ? (
                        <EmptyState
                          title="No products set up yet"
                          hint="Enable the products you sell, then approve them here."
                          action={readOnly || selectedPartner.status === "offboarded" ? undefined : <Button type="button" variant="outline" onClick={() => setDetailTab("products")}>Set up products</Button>}
                        />
                      ) : (
                        <p className="mt-3 text-sm text-muted-foreground">Product approvals are managed by the account owner.</p>
                      )
                    )}
                  </section>
                  <div className="grid gap-3">
                    <section className="rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Contact</h3>
                        {!readOnly && selectedPartner.status !== "offboarded" && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(selectedPartner)}>Edit</Button>
                        )}
                      </div>
                      <div className="mt-2 space-y-1.5 text-sm">
                        {selectedPartner.contact_name && <p className="font-medium">{selectedPartner.contact_name}</p>}
                        {selectedPartner.contact_email && <p className="break-all text-muted-foreground">{selectedPartner.contact_email}</p>}
                        <p className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden="true" />
                          {selectedPartner.country} · {selectedPartner.timezone}
                        </p>
                      </div>
                    </section>
                    <section className="rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Notes</h3>
                        {!readOnly && selectedPartner.status !== "offboarded" && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(selectedPartner)}>{selectedPartner.notes ? "Edit" : "Add"}</Button>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground" title={selectedPartner.notes ?? undefined}>
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
                </div>
                </div>
              )}
              {detailTab === "terms" && (
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      New rates apply from their effective date. Past leads keep their original terms.
                    </p>
                    {!readOnly && selectedPartner.status !== "offboarded" && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setTermDate(new Date().toISOString().slice(0, 10));
                          setTermFor(selectedPartner.id);
                        }}
                      >
                        <Plus aria-hidden="true" />
                        Add terms
                      </Button>
                    )}
                  </div>
                  {selectedPartner.terms.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="portal-lead-table w-full min-w-[520px]! text-left text-sm">
                        <thead><tr><th>Terms</th><th>Effective</th><th className="text-right"><span className="sr-only">State</span></th></tr></thead>
                        <tbody>
                          {selectedPartner.terms.map((term, index) => (
                            <tr key={term.id} className={index === 0 ? "bg-[var(--primary-soft)]" : undefined}>
                              <td className="font-semibold">
                                {term.payout_model === "revenue_share"
                                  ? `${((term.rate_pct_bp ?? 0) / 100).toFixed(2)}% revenue share`
                                  : `${PARTNER_PAYOUT_MODEL_LABELS[term.payout_model]} · ${money(term.rate_cents)}`}
                              </td>
                              <td className="whitespace-nowrap text-muted-foreground">{dateLabel(term.effective_from)}</td>
                              <td className="text-right">{index === 0 && <StatusChip tone="info">Current</StatusChip>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState
                      title="No terms yet"
                      hint="Record what this partner is paid."
                      action={readOnly || selectedPartner.status === "offboarded" ? undefined : <Button type="button" variant="outline" onClick={() => { setTermDate(new Date().toISOString().slice(0, 10)); setTermFor(selectedPartner.id); }}><Plus aria-hidden="true" />Add terms</Button>}
                    />
                  )}
                </section>
              )}
              {detailTab === "products" && (
                <section className="space-y-4">
                  {/* Settings › Products (2026-10-27) decides what the agency sells; this tab only says
                      which of those this partner may send. */}
                  <p className="m-0 text-sm text-muted-foreground">
                    {products.some((product) => product.is_enabled)
                      ? <>Your agency sells {products.filter((product) => product.is_enabled).map((product) => product.name).join(", ")}.</>
                      : <>Your agency does not sell any product yet.</>}{" "}
                    {canManageProductConfig && <Link href="/app/settings#products" className="font-semibold text-foreground underline underline-offset-2">Change in Settings › Products</Link>}
                  </p>
                  {canManageProductConfig ? (
                    <div>
                      <h3 className="text-sm font-semibold">Approved for this partner</h3>
                      <div className="mt-3 space-y-2">
                        {selectedProducts.filter((product) => product.is_enabled).map((product) => (
                          <label key={product.code} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={product.approved}
                              disabled={readOnly || busy !== null || selectedPartner.status === "offboarded"}
                              onChange={() => void togglePartnerProduct(selectedPartner.id, product)}
                            />
                            <span>{product.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      Product approvals are managed by the account owner.
                    </p>
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
              {detailTab === "activity" && (
                <section className="space-y-3 text-sm">
                  {/* This used to link to /app/audit-log, which is not a route — the agent plane
                      has no audit-log viewer, so the link rendered a 404 inside the shell. The
                      events are still recorded; what is missing is a screen for them. Naming
                      only what can actually be opened is the honest version. */}
                  <p className="text-muted-foreground">
                    Every lifecycle change, terms update, invitation, and access change is
                    audit-logged and kept. Review the leads connected to this partner in the lead
                    workspace; the audit trail itself is available to your account administrator.
                  </p>
                  <Button asChild variant="outline">
                    <Link href="/app/leads">
                      <ArrowRight aria-hidden="true" />
                      Open lead workspace
                    </Link>
                  </Button>
                </section>
              )}
            </div>
              </section>
            </div>
          </div>
        )}
      </div>
      {/* Commercial terms are added in a dialog (2026-10-06 redesign), not a form that pushes the history down. */}
      <Dialog open={selectedPartner !== null && termFor === selectedPartner.id && !readOnly && selectedPartner.status !== "offboarded"} onOpenChange={(open) => { if (!open) setTermFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add terms</DialogTitle>
            <DialogDescription>New rates apply from their effective date. Past leads keep their original terms.</DialogDescription>
          </DialogHeader>
          {selectedPartner && (
            <form
              onSubmit={(event) =>
                void saveTerm(event, selectedPartner.id)
              }
              className="space-y-4"
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
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTermFor(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy !== null}>
                  Save terms
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
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
                ? "Its history stays as it was."
                : "A publisher, marketing company or affiliate."}
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
