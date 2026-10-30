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
import { useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/lib/notify";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  MapPin,
  MessagesSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  SlidersHorizontal,
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
  PARTNER_TYPES,
  type PartnerPayoutModel,
  type PartnerStatus,
  type PartnerType,
} from "@/lib/partners/constants";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, ViewTabs } from "@/components/ui/view-tabs";
import { PartnerOnboarding } from "@/components/app/partner-onboarding";
import { PageLoading } from "@/components/ui/page-loading";
import { TableCard } from "@/components/ui/table-card";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { FILL_CARD, useFittingRows } from "@/components/app/use-fitting-rows";
import { PARTNER_LIMIT_KEYS } from "@/lib/partners/limits";
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
  "overview" | "terms" | "products" | "markets" | "forms" | "team" | PartnerExtraTab;

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
// Five, named for the job (UI-CONSISTENCY §15). "Activity" went on 2026-10-29: its whole panel was a
// paragraph saying the audit trail is not viewable here plus a link to the lead workspace, so it was
// a tab that apologised rather than did anything ("whatever is not functional, we need to remove" —
// owner, 29 Oct). An old ?tab=activity link falls through to Overview, as any unknown tab does.
const detailTabs: DetailTab[] = [
  "overview",
  "products",
  "forms",
  "terms",
  "markets",
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

/** On / off for a product, as the kit's status chip (Foundation v3: dot plus text). */
/** L4 (owner, 2026-10-28): what each kind of publisher does, in the agent's words. */
const SOURCE_TYPE_CHOICE: Record<PartnerType, string> = {
  publisher: "Transfers live calls to me",
  marketing: "Sells me leads",
  affiliate: "Refers clients to me",
};
/** The same, short, for the list and its filter. */
const SOURCE_TYPE_SHORT: Record<PartnerType, string> = {
  publisher: "Live transfers",
  marketing: "Lead seller",
  affiliate: "Referrals",
};
/** Why a new source could not go Active, in the agent's words: almost always the plan's limit. */
function friendlyActivation(reason: string): string {
  return /limit|max_|cap/i.test(reason) ? "Your plan's limit for this kind of source is used. Pause another one or upgrade, then activate it from its Actions menu." : "Activate it from its Actions menu.";
}

/** How a source is usually paid, by kind: the form starts there (L2). */
const DEFAULT_PAY: Record<PartnerType, PartnerPayoutModel> = { publisher: "per_transfer", marketing: "per_lead", affiliate: "per_sale" };

/**
 * Where the source works from (manager review 28 Oct §6: "Country" was free text). Every ISO 3166-1
 * country is offered (owner, 2026-10-29: "we should have all the countries here"); the nine call
 * centres most often work from keep their place at the top, which is what the old short list was for.
 * Names come from the runtime, so there is no name table here to fall out of date.
 */
const COMMON_COUNTRY_CODES = ["US", "CA", "MX", "DO", "JM", "CO", "PH", "IN", "PK"];
const ISO_COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ");
const REGION_NAMES = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
/** A country's name, or its code where the runtime has no name for it. */
const countryName = (code: string): string => { try { return REGION_NAMES?.of(code) ?? code; } catch { return code; } };

/** The zones worth naming per country. Anywhere else gets every IANA zone, which the menu can search. */
const CURATED_ZONES: Record<string, ReadonlyArray<readonly [string, string]>> = {
  CA: [["America/Toronto", "Eastern (Toronto)"], ["America/Winnipeg", "Central (Winnipeg)"], ["America/Edmonton", "Mountain (Edmonton)"], ["America/Vancouver", "Pacific (Vancouver)"]],
  MX: [["America/Mexico_City", "Mexico City"], ["America/Tijuana", "Tijuana"]],
  DO: [["America/Santo_Domingo", "Santo Domingo"]],
  JM: [["America/Jamaica", "Kingston"]],
  CO: [["America/Bogota", "Bogotá"]],
  PH: [["Asia/Manila", "Manila"]],
  IN: [["Asia/Kolkata", "India"]],
  PK: [["Asia/Karachi", "Karachi"]],
};
/** "Europe/Berlin" reads as "Berlin · Europe": the city first, since that is what people look for. */
const zoneLabel = (id: string): string => {
  const parts = id.split("/");
  const city = (parts[parts.length - 1] ?? id).replace(/_/g, " ");
  return parts.length > 1 ? `${city} · ${parts[0].replace(/_/g, " ")}` : city;
};
const ALL_TIME_ZONES: ReadonlyArray<readonly [string, string]> = (() => {
  try {
    const ids = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return ids.map((id) => [id, zoneLabel(id)] as const);
  } catch { return []; }
})();
/**
 * The IANA zones the runtime knows for a country (`Intl.Locale.prototype.timeZones`). This is what
 * keeps the zone honest when the country changes: offering every zone in the world made the old
 * "is the current zone still valid?" test always true, so picking Germany kept New York.
 */
const regionZones = (code: string): readonly string[] => {
  try {
    const locale = new Intl.Locale(`und-${code}`) as Intl.Locale & { timeZones?: string[]; getTimeZones?: () => string[] };
    return locale.timeZones ?? locale.getTimeZones?.() ?? [];
  } catch { return []; }
};
const zonesFor = (country: string): ReadonlyArray<readonly [string, string]> => {
  const curated = CURATED_ZONES[country];
  if (curated?.length) return curated;
  if (country === "US") return US_TIME_ZONES;
  const theirs = regionZones(country);
  if (theirs.length) return theirs.map((id) => [id, zoneLabel(id)] as const);
  return ALL_TIME_ZONES.length ? ALL_TIME_ZONES : US_TIME_ZONES;
};

/** L3: US time zones, so nobody types an IANA name. Anything else on file is kept as an extra option. */
const US_TIME_ZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
  ["America/Puerto_Rico", "Puerto Rico"],
] as const;
function homeTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return US_TIME_ZONES.some(([value]) => value === zone) ? zone : "America/New_York";
  } catch {
    return "America/New_York";
  }
}

const emptyDraft: PartnerDraft = {
  name: "",
  partner_type: "publisher",
  // Manager review §6: a country choice again, the US by default.
  country: "US",
  contact_name: "",
  contact_email: "",
  timezone: "America/New_York",
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
/** The same meaning as the row's chip, as a dot in the status filter's list (UI-CONSISTENCY §12). */
const STATUS_DOT: Record<PartnerStatus, string> = {
  draft: "bg-[var(--muted)]",
  active: "bg-[var(--success)]",
  paused: "bg-[var(--warning)]",
  offboarded: "bg-[var(--muted)]",
};

/**
 * One limit of the plan, said once ("1 of 5"), with a thin bar. Four of these share one strip: the
 * ring cards before said each number three times ("1/5 · 1 of 5 · 1 of 5 live transfer sources").
 */
function PlanRoom({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const full = limit != null && used >= limit;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className={cn("text-sm font-semibold tabular-nums", full ? "text-[var(--warning-ink)]" : "text-foreground")}>{limit == null ? `${used} active` : `${used} of ${limit}`}</span>
      </div>
      {limit != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-alt)]" aria-hidden="true">
          <div className={cn("h-full rounded-full", full ? "bg-[var(--warning)]" : "bg-[var(--primary)]")} style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} />
        </div>
      )}
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
  // L2: how this source is paid, asked when it is added (optional; "Not sure yet" skips it).
  const [newPay, setNewPay] = useState<PartnerPayoutModel | "none">("per_transfer");
  const [newRate, setNewRate] = useState("");
  // L8: during Get set up, the form stays open after an add so the next one is one click away.
  const guiding = useSearchParams().has("guide");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [, setProducts] = useState<Product[]>([]);
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
    if (editing) {
      const ok = await send(`/api/app/partners/${editing}`, "PATCH", { action: "update", ...draft }, "Publisher updated");
      if (ok) {
        setDraft(emptyDraft);
        setEditing(null);
        setDialogOpen(false);
      }
      return;
    }
    // Added, then (when given) its pay, from the new record's id (L2).
    const rate = Number(newRate);
    const pay = newPay !== "none" && newRate.trim() !== "" && Number.isFinite(rate) && rate >= 0 ? newPay : null;
    setBusy("/api/app/partners");
    try {
      const response = await fetch("/api/app/partners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.partner?.id) { notify.block(result?.error ?? "Could not add the publisher"); return; }
      if (pay) {
        const today = new Date();
        const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const term = await fetch(`/api/app/partners/${result.partner.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pay === "revenue_share"
            ? { action: "add_term", payout_model: pay, rate_cents: null, rate_pct_bp: Math.round(rate * 100), effective_from: from }
            : { action: "add_term", payout_model: pay, rate_cents: Math.round(rate * 100), rate_pct_bp: null, effective_from: from }),
        });
        if (!term.ok) {
          const body = await term.json().catch(() => null);
          notify.warn(`${draft.name} was added, but its pay was not saved`, { detail: body?.error ?? "Add it on the source's Commercial terms tab." });
        }
      }
      if (result.activationRefused) notify.warn(`${draft.name} was added as a draft`, { detail: friendlyActivation(result.activationRefused) });
      else notify.done(`${draft.name} added`);
      await load();
      setNewRate("");
      setNewPay(DEFAULT_PAY[emptyDraft.partner_type]);
      if (guiding) {
        // L8: stay here, ready for the next one.
        setJustAdded(draft.name);
        setDraft({ ...emptyDraft, timezone: draft.timezone });
      } else {
        setDraft(emptyDraft);
        setDialogOpen(false);
      }
    } catch (reason) {
      notify.fail("Could not add the publisher", { detail: reason instanceof Error ? reason.message : undefined });
    } finally {
      setBusy(null);
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
    setDraft({ ...emptyDraft, timezone: homeTimeZone() });
    setNewPay(DEFAULT_PAY[emptyDraft.partner_type]);
    setNewRate("");
    setJustAdded(null);
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
  // What each filter would leave, shown on its option (owner, 2026-10-29). Counted against every
  // publisher, not the filtered list, so the numbers do not move as you narrow them down.
  const filterCounts = useMemo(() => {
    const byType = {} as Record<PartnerType, number>;
    const byStatus = {} as Record<PartnerStatus, number>;
    for (const partner of partners) {
      byType[partner.partner_type] = (byType[partner.partner_type] ?? 0) + 1;
      byStatus[partner.status] = (byStatus[partner.status] ?? 0) + 1;
    }
    return { byType, byStatus };
  }, [partners]);
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

  // Said as it is typed (manager review §6), only once there is something that is clearly not an email.
  const emailLooksWrong = draft.contact_email.trim().length > 3 && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.contact_email.trim());

  if (loading) return <PageLoading />;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {readOnly && (
        <div role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
          Your account is read-only. You can review partner records, but changes
          are unavailable until billing is restored.
        </div>
      )}
      <PageHeader
        visible
        title={detailOnly ? (selectedPartner?.name ?? "Publisher") : "Publishers"}
        // The list's one line is an explanation, so it goes behind the (i) and gives the row back to
        // the table (owner, 2026-10-29). A partner's own line is not: it says which partner and whose
        // contact this is, so it stays on screen.
        infoDescription={!detailOnly}
        description={detailOnly
          ? (selectedPartner ? `${SOURCE_TYPE_SHORT[selectedPartner.partner_type]}${selectedPartner.contact_name ? ` · ${selectedPartner.contact_name}` : ""}` : undefined)
          : "Everyone who sends you leads or live calls: what you pay them, and how they are doing this month."}
        breadcrumbs={detailOnly
          ? [{ label: "Partners" }, { label: "Publishers", href: "/app/publishers" }, { label: selectedPartner?.name ?? "Publisher" }]
          : [{ label: "Partners" }, { label: "Publishers" }]}
        // Status, then the two facts that used to sit in the figure strip pretending to be figures.
        // The portal-user count has gone: Overview's onboarding already says whether anyone is
        // invited, and saying it twice made the header look like a dashboard (owner, 2026-10-29).
        meta={detailOnly && selectedPartner ? (
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusChip tone={statusTone(selectedPartner.status)}>{PARTNER_STATUS_LABELS[selectedPartner.status]}</StatusChip>
            <span className="text-xs text-muted-foreground">{termText(selectedPartner.active_term)}</span>
            {earliestTerm(selectedPartner) && <span className="text-xs text-muted-foreground">Since {dateLabel(earliestTerm(selectedPartner))}</span>}
          </span>
        ) : undefined}
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
                  <Edit3 data-icon="inline-start" aria-hidden="true" />Edit publisher
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
                Add publisher
              </Button>
            </>
          )
        }
      />
      {/* Only when the plan sets a limit: four bare counts of active sources read as wrong beside the
          table (owner's demo account, 2026-10-29). */}
      {!detailOnly && partners.length > 0 && [limits.max_publishers, limits.max_marketing_partners, limits.max_affiliates, limits.max_partner_users].some((limit) => limit != null) && (
        <section aria-label="Room on your plan" className="m-glass grid grid-cols-2 gap-x-6 gap-y-3 rounded-[12px] border border-border px-4 py-3 lg:grid-cols-4">
          <PlanRoom label="Live transfer sources" used={usage.publishers} limit={limits.max_publishers} />
          <PlanRoom label="Lead sellers" used={usage.marketing} limit={limits.max_marketing_partners} />
          <PlanRoom label="Referral partners" used={usage.affiliates} limit={limits.max_affiliates} />
          <PlanRoom label="Partner logins" used={usage.partnerUsers} limit={limits.max_partner_users} />
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
          className={`${FILL_CARD} min-h-[calc(100dvh-var(--top-bar-h)-164px)] min-w-0`}
          toolbar={
            <DataToolbar actions={<>
              {listFiltered && <ClearFiltersButton onClick={clearListFilters} />}
              <RefreshButton onClick={() => void load()} refreshing={refreshing} />
            </>}>
              <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setListPage(1); }} placeholder="Search publishers" />
              {/* The kit's SelectMenu, not a native <select> (owner, 2026-10-29: the plain dropdowns,
                  with a search at the top of the panel). Each option carries what it would leave, and
                  the trigger tints while it holds anything but "all", so a narrowed list says so. */}
              {!selectedPartner && (
                <SelectMenu
                  label="Filter by partner type"
                  value={typeFilter}
                  defaultValue="all"
                  onChange={(next) => { setTypeFilter(next); setListPage(1); }}
                  icon={<SlidersHorizontal className="size-4" />}
                  searchPlaceholder="Search types"
                  // The panel takes the trigger's own width (owner, 2026-10-29: the design is right,
                  // the widths were not): a menu wider than the control it hangs off reads as loose.
                  className="w-52"
                  panelClassName="w-[var(--radix-popover-trigger-width)]"
                  options={[
                    { value: "all" as const, label: "All Types", count: partners.length, group: "Type" },
                    ...PARTNER_TYPES.map((type) => ({
                      value: type,
                      label: SOURCE_TYPE_SHORT[type],
                      count: filterCounts.byType[type] ?? 0,
                      group: "Type",
                      disabled: (filterCounts.byType[type] ?? 0) === 0,
                    })),
                  ]}
                />
              )}
              {!selectedPartner && (
                <SelectMenu
                  label="Filter by partner status"
                  value={statusFilter}
                  defaultValue="all"
                  onChange={(next) => { setStatusFilter(next); setListPage(1); }}
                  icon={<SlidersHorizontal className="size-4" />}
                  searchPlaceholder="Search statuses"
                  className="w-52"
                  panelClassName="w-[var(--radix-popover-trigger-width)]"
                  options={[
                    { value: "all" as const, label: "All Statuses", count: partners.length, group: "Status" },
                    ...(["draft", "active", "paused", "offboarded"] as PartnerStatus[]).map((status) => ({
                      value: status,
                      label: PARTNER_STATUS_LABELS[status],
                      count: filterCounts.byStatus[status] ?? 0,
                      dot: STATUS_DOT[status],
                      group: "Status",
                      disabled: (filterCounts.byStatus[status] ?? 0) === 0,
                    })),
                  ]}
                />
              )}
            </DataToolbar>
          }
          footer={<Pager page={listCurrent} total={filteredPartners.length} pageSize={listPageSize} noun="publishers" onPage={setListPage} suffix={`${partners.length} publisher${partners.length === 1 ? "" : "s"} in all`} />}
        >
            {partners.length === 0 && !listFiltered ? (
              <EmptyState title="No publishers yet" hint="Add each company that sends you leads, transfers calls to you or refers clients." />
            ) : filteredPartners.length === 0 ? (
              <NoMatches noun="publishers" onClear={clearListFilters} />
            ) : (
              <table className="portal-lead-table w-full text-left text-sm table-fixed min-w-[940px]">
                <thead>
                  <tr>
                    {/* Only the name is flexible: it is the column people scan, so it takes the slack.
                        Every other column holds a known shape — a chip, a count, a date, a term — and
                        is sized for it. Left to `auto`, the browser gave Status 355px to hold one chip
                        while the name had 282 (owner, 2026-10-29: "somewhere there is more space,
                        somewhere else"). Widths here are budgeted against the table's own min width;
                        lib/design/uiConsistency.test.mjs keeps the flexible column from being crushed. */}
                    <th>Publisher</th>
                    {!selectedPartner && <th className="w-[220px]">Status</th>}
                    {!selectedPartner && <th className="w-[110px] text-right" title="Live transfers or leads received this month">This Month</th>}
                    {!selectedPartner && <th className="w-[90px] text-right" title="Sales this month">Sales</th>}
                    {!selectedPartner && <th className="w-[120px]">Last Lead</th>}
                    {!selectedPartner && <th className="w-[170px]">You Pay</th>}
                    <th className="w-[64px] text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {listRows.map((partner) => {
                    const dropHeavy = partner.transfers_this_month >= 10 && partner.dropped_this_month / partner.transfers_this_month >= 0.15;
                    // A live-transfer source is counted in calls; the others in leads.
                    const volume = partner.partner_type === "publisher"
                      ? `${partner.transfers_this_month.toLocaleString()} ${partner.transfers_this_month === 1 ? "call" : "calls"}`
                      : `${partner.lead_volume_this_month.toLocaleString()} ${partner.lead_volume_this_month === 1 ? "lead" : "leads"}`;
                    return (
                      // The whole row opens the partner, as in any list people use daily (2026-10-29); the
                      // name stays a button so the keyboard reaches it.
                      <tr
                        key={partner.id}
                        className={cn("m-row group", !selectedPartner && "cursor-pointer", selectedPartner?.id === partner.id && "bg-[var(--primary-soft)]")}
                        onClick={(event) => {
                          if (selectedPartner || (event.target as HTMLElement).closest("button, a")) return;
                          router.push(`/app/publishers/${partner.id}`);
                        }}
                      >
                        {/* The column's width now comes from its header, and the name truncates
                            inside it, so the cell needs no cap of its own. */}
                        <td>
                          <button
                            type="button"
                            className="flex w-full min-w-0 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            // One partner has one page (/app/publishers/[id]) — the same layout whether it
                            // was opened from here or from a link, so the two can never drift apart.
                            onClick={() => router.push(`/app/publishers/${partner.id}`)}
                          >
                            <span className="truncate font-semibold text-foreground" title={partner.name}>{partner.name}</span>
                            <span className="truncate text-xs text-muted-foreground">{SOURCE_TYPE_SHORT[partner.partner_type]}</span>
                          </button>
                        </td>
                        {!selectedPartner && (
                          <td className="whitespace-nowrap">
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <StatusChip tone={statusTone(partner.status)}>
                                {PARTNER_STATUS_LABELS[partner.status]}
                              </StatusChip>
                              {dropHeavy && <StatusChip tone="warning">Many dropped calls</StatusChip>}
                              {partner.status === "offboarded" && (
                                <span className="text-xs text-muted-foreground">
                                  {partner.offboarded_at ? `${dateLabel(partner.offboarded_at)} · ` : ""}history kept
                                </span>
                              )}
                            </span>
                          </td>
                        )}
                        {!selectedPartner && <td className="whitespace-nowrap text-right tabular-nums">{volume}</td>}
                        {!selectedPartner && <td className="text-right tabular-nums">{partner.completed_this_month}</td>}
                        {!selectedPartner && <td className="whitespace-nowrap text-muted-foreground">{partner.last_submission ? dateLabel(partner.last_submission) : "None yet"}</td>}
                        {!selectedPartner && <td className="whitespace-nowrap text-muted-foreground">{termText(partner.active_term)}</td>}
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
                            <Link
                              href={`/app/publishers/${partner.id}`}
                              aria-label={`Open ${partner.name}`}
                              className="inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--muted)] transition-colors group-hover:bg-[var(--surface-alt)] group-hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
                            >
                              <ChevronRight className="size-4" aria-hidden="true" />
                            </Link>
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
            {/* Figures only, in the kit's strip (UI-CONSISTENCY §4). Until 2026-10-29 this was five
                hand-rolled tiles of which three held no figure at all — "You pay", "Since" and
                "Last lead" are facts about the publisher, and a strip that mixes how-many with
                what-kind teaches the eye to skip all five. The two facts now sit on the identity
                line under the title; "Last lead" is what this month's figure is doing, so it is its
                footnote. Sales joins it: the list has shown that column all along. */}
            <StatStrip label="This publisher's month">
              <StatTile
                label={selectedPartner.partner_type === "publisher" ? "Calls This Month" : "Leads This Month"}
                value={(selectedPartner.partner_type === "publisher" ? selectedPartner.transfers_this_month : selectedPartner.lead_volume_this_month).toLocaleString()}
                footnote={selectedPartner.last_submission ? `Last: ${dateLabel(selectedPartner.last_submission)}` : "None yet"}
              />
              <StatTile
                label="Sales This Month"
                value={selectedPartner.completed_this_month.toLocaleString()}
                reserveFootnote
              />
              <StatTile
                label="Approved Products"
                value={selectedProducts.length ? `${selectedProducts.filter((product) => product.approved).length} of ${selectedProducts.length}` : "—"}
                reserveFootnote
              />
            </StatStrip>

            <div className="flex min-w-0 flex-col gap-6">
              <ViewTabs
                label="Partner record"
                value={detailTab}
                onChange={setDetailTab}
                idPrefix="partner-detail-tab"
                controls="partner-detail-view"
                tabs={shownTabs.map((tab) => ({ key: tab, label: detailTabLabel(tab) }))}
              />
              <section className="m-glass rounded-xl border border-border min-w-0 overflow-visible">
            {/* The selected section, as the tab panel: it fades in when the tab changes (2026-10-09).
                It does NOT scroll inside itself: penning a long tab into a short box looked worse than
                the page scroll it replaced (owner, 2026-10-29). The page scrolls, as it always did. */}
            <div key={detailTab} role="tabpanel" id="partner-detail-view" aria-labelledby={`partner-detail-tab-${detailTab}`} className="space-y-5 p-5">
              {detailTab === "overview" && (
                <div className="flex min-w-0 flex-col gap-6">
                  <PartnerOnboarding
                    partnerId={selectedPartner.id}
                    hasTerm={Boolean(selectedPartner.active_term)}
                    termText={termText(selectedPartner.active_term)}
                    approved={partnerProducts[selectedPartner.id] ? { count: selectedProducts.filter((product) => product.approved).length, total: selectedProducts.length } : null}
                    lastSubmission={selectedPartner.last_submission}
                    onGo={readOnly || selectedPartner.status === "offboarded" ? undefined : (to) => {
                      if (to === "people") document.getElementById("partner-section-team")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      else setDetailTab(to);
                    }}
                  />
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
                  {/* The products table lived here as well as in its own tab, with a button whose only
                      job was to open that tab — the same list twice, one linking to the other. The
                      strip above already carries the figure ("Approved Products 2 of 8"); the detail
                      is one tab away (owner, 2026-10-29: simplify). */}
                  <div className="grid gap-3 md:grid-cols-2">
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
                          {countryName(selectedPartner.country)} · {zonesFor(selectedPartner.country).find(([value]) => value === selectedPartner.timezone)?.[1] ?? selectedPartner.timezone} time
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
                // One list: what this partner may send (2026-10-29). Which products the agency sells
                // is set once, in Settings › Products, not repeated on every partner.
                <section className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">What {selectedPartner.name} may send</h3>
                    <Link href="/app/settings#products" className="text-xs font-medium text-[var(--accent-ink)] hover:underline">
                      Products your agency sells: Settings › Products
                    </Link>
                  </div>
                  {canManageProductConfig && selectedProducts.length > 0 && !selectedProducts.some((product) => product.is_enabled) ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--border-strong)] px-4 py-3 text-sm">
                      <span className="text-[var(--body)]">Your agency sells no products yet, so there is nothing to approve for {selectedPartner.name}.</span>
                      <Button asChild size="sm"><Link href="/app/settings#products">Choose products</Link></Button>
                    </div>
                  ) : canManageProductConfig ? (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {selectedProducts.map((product) => (
                        <label
                          key={product.code}
                          className={cn("flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors", product.approved && "border-[var(--primary)] bg-[var(--primary-soft)]", !product.is_enabled && "opacity-50")}
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
                          <span className="min-w-0 flex-1 font-medium">{product.name}</span>
                          {!product.is_enabled && (
                            <span className="text-xs text-muted-foreground">Your agency does not sell it</span>
                          )}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      Product availability is managed by the account owner.
                    </p>
                  )}
                </section>
              )}
              {detailTab === "markets" && (
                <PartnerMarketAccessPanel
                  compact
                  partnerId={selectedPartner.id}
                  readOnly={readOnly || selectedPartner.status === "offboarded"}
                />
              )}
              {detailTab === "forms" && (
                // `embedded`: the studio draws its own card and title, which inside this tab's card
                // read as a page nested in a page (owner, 2026-10-29). The banner that used to sit
                // above it said the phone field cannot be removed — the field list already locks
                // that row (`locked` on the phone field), so the banner only repeated the control.
                <PartnerFormStudio
                  embedded
                  partnerId={selectedPartner.id}
                  readOnly={readOnly || selectedPartner.status === "offboarded"}
                />
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
                <Label>Payout model</Label>
                <SelectMenu
                  label="Payout model"
                  value={termModel}
                  onChange={(model: PartnerPayoutModel) => setTermModel(model)}
                  searchPlaceholder="Search payout models"
                  className="w-full"
                  panelClassName="w-[var(--radix-popover-trigger-width)]"
                  options={PARTNER_PAYOUT_MODELS.map((model) => ({ value: model, label: PARTNER_PAYOUT_MODEL_LABELS[model] }))}
                />
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
        {/* A 560px dialog (two columns of short fields); `size` here is the dialog's width, not a tall control. */}
        <DialogContent size={"lg"} className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit publisher" : "Add a publisher"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Its history stays as it was."
                : "A company that sends you leads, transfers calls to you or refers clients."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePartner} className="grid gap-4 md:grid-cols-2">
            {justAdded && (
              <p role="status" className="m-0 rounded-md bg-[var(--success-surface)] px-3 py-2 text-sm text-[var(--success-ink)] md:col-span-2">
                {justAdded} added. Add another, or close this to continue.
              </p>
            )}
            {/* Manager review 28 Oct §6: who they are, who to talk to, where they are, then money. */}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="partner-name">Company name</Label>
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
            <div className="space-y-1.5 md:col-span-2">
              <Label>What they do for you</Label>
              {/* Three choices, so all three stay on screen (UI-CONSISTENCY §15) instead of hiding two
                  of them in a dropdown. The short name is the button and the sentence under it says
                  what the chosen one means, so shortening the labels loses nothing. */}
              <Segmented
                label="What they do for you"
                value={draft.partner_type}
                onChange={(type: PartnerType) => {
                  setDraft({ ...draft, partner_type: type });
                  if (!editing) setNewPay(DEFAULT_PAY[type]);
                }}
                options={PARTNER_TYPES.map((type) => ({ key: type, label: SOURCE_TYPE_SHORT[type] }))}
              />
              <p className="m-0 text-xs text-muted-foreground">{SOURCE_TYPE_CHOICE[draft.partner_type]}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-contact">Contact name</Label>
              <Input
                id="partner-contact"
                value={draft.contact_name}
                onChange={(event) =>
                  setDraft({ ...draft, contact_name: event.target.value })
                }
                placeholder="The person you deal with"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-email">Contact email</Label>
              <Input
                id="partner-email"
                type="email"
                value={draft.contact_email}
                aria-invalid={emailLooksWrong || undefined}
                aria-describedby={emailLooksWrong ? "partner-email-problem" : undefined}
                onChange={(event) =>
                  setDraft({ ...draft, contact_email: event.target.value })
                }
                placeholder="ops@example.com"
              />
              {emailLooksWrong && <p id="partner-email-problem" className="m-0 text-xs text-[var(--error-ink)]">That doesn&rsquo;t look like an email address.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Country</Label>
              <SelectMenu
                label="Country"
                value={draft.country}
                onChange={(country: string) => {
                  const zones = zonesFor(country);
                  // The time zone follows the country unless it is already one of that country's.
                  setDraft({ ...draft, country, timezone: zones.some(([value]) => value === draft.timezone) ? draft.timezone : zones[0][0] });
                }}
                searchPlaceholder="Search countries"
                className="w-full"
                panelClassName="w-[var(--radix-popover-trigger-width)]"
                options={[
                  ...COMMON_COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code), group: "Common" })),
                  ...ISO_COUNTRY_CODES
                    .filter((code) => !COMMON_COUNTRY_CODES.includes(code))
                    .map((code) => ({ value: code, label: countryName(code), group: "All Countries" }))
                    .sort((left, right) => left.label.localeCompare(right.label)),
                  ...(ISO_COUNTRY_CODES.includes(draft.country) ? [] : [{ value: draft.country, label: draft.country, group: "On File" }]),
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Their time zone</Label>
              <SelectMenu
                label="Their time zone"
                value={draft.timezone}
                onChange={(timezone: string) => setDraft({ ...draft, timezone })}
                searchPlaceholder="Search time zones"
                className="w-full"
                panelClassName="w-[var(--radix-popover-trigger-width)]"
                options={[
                  ...zonesFor(draft.country).map(([value, label]) => ({ value, label })),
                  ...(zonesFor(draft.country).some(([value]) => value === draft.timezone) ? [] : [{ value: draft.timezone, label: draft.timezone }]),
                ]}
              />
            </div>
            {!editing && (
              <>
                <div className="space-y-1.5">
                  <Label>How you pay them</Label>
                  <SelectMenu
                    label="How you pay them"
                    value={newPay}
                    onChange={(model: PartnerPayoutModel | "none") => setNewPay(model)}
                    searchPlaceholder="Search payout models"
                    className="w-full"
                    panelClassName="w-[var(--radix-popover-trigger-width)]"
                    options={[
                      ...PARTNER_PAYOUT_MODELS.map((model) => ({ value: model, label: PARTNER_PAYOUT_MODEL_LABELS[model] })),
                      { value: "none" as const, label: "Not sure yet" },
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="partner-rate">{newPay === "revenue_share" ? "Share (%)" : "Amount ($)"}</Label>
                  <Input
                    id="partner-rate"
                    inputMode="decimal"
                    value={newRate}
                    disabled={newPay === "none"}
                    onChange={(event) => setNewRate(event.target.value)}
                    placeholder={newPay === "revenue_share" ? "e.g. 20" : "e.g. 35"}
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="partner-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
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
                {justAdded ? "Done" : "Cancel"}
              </Button>
              <Button type="submit" disabled={busy !== null || createAtLimit || emailLooksWrong}>
                {busy ? "Saving…" : editing ? "Save" : justAdded ? "Add another" : "Add publisher"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
