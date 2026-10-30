"use client";

import { csvCell } from "@/lib/csv/cell";
import { StatusChip } from "@/components/ui/status-chip";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Ban, BookUser, Bookmark, Check, ChevronDown, CircleAlert, Flag, Plus, Sparkles, Store, Upload, UserCheck, X, type LucideIcon } from "lucide-react";
import { notify } from "@/lib/notify";
import { isOwnBookVendor, OWN_BOOK_CAMPAIGN_NAME, OWN_BOOK_VENDOR_NAME } from "@/lib/campaigns/ownBook";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputControl } from "@/components/ui/field";
import { InfoTip } from "@/components/ui/info-tip";
import { NextUp, type NextUpTone } from "@/components/app/lead-sources/next-up";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { PagedBody, PagedPager, PagedProvider } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import { Callout, DashedCard, st } from "@/components/app/settings/primitives";
import { columnMappingStatus, type MappingRow } from "@/components/app/column-mapping-dialog";
import { EMPTY_DATE_SCAN, inferredImportDateOrder, isImportDateOrder, parseCsv, previewLeadCsv, slashDateReadings, suggestLeadCsvMappings, type ImportDateOrder } from "@/lib/agentTemplates/csv";
import { IMPORT_CSV_KEY, parseDollarsToCents, parseRecordCount } from "@/lib/agentTemplates/importReviewModel";
import { isXlsxFile, readXlsxAsCsv, XLSX_TYPES } from "@/lib/agentTemplates/xlsx";
import { TEMPLATE_FIELD_TYPE_LABELS, type TemplateFieldType } from "@/lib/templates/constants";
import { cn } from "@/lib/utils";

type SavedMap = { id: string; vendor_id: string; product_code: string; mapping: Record<string, string | null>; updated_at: string; date_order?: ImportDateOrder | null };
type ImportInfo = { product: { name: string }; productCode: string; products?: Array<{ code: string; name: string }>; fields: Array<{ key: string; label: string; type: TemplateFieldType; required: boolean; options: string[]; sort_order: number }>; stages: Array<{ id: string; name: string }>; campaigns: Array<{ id: string; vendor_id: string; name: string; status: string }>; vendors: Array<{ id: string; name: string; lead_type: string; status: string }>; mappings: SavedMap[]; limits: Array<{ key: string; label: string; usage: number; limit: number | null; hardCap: boolean; allowed: boolean }>; maxRows: number; canCreateCampaigns?: boolean };

function downloadFieldTemplate(fields: ImportInfo["fields"]) {
  // The shared cell (lib/csv/cell.ts): the same quoting, plus the formula guard every export has.
  const csv = `${fields.map((field) => csvCell(field.label)).join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "insurvas-lead-template.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Key-sorted, so two maps with the same entries compare equal. */
const mapKey = (mapping: Record<string, string | null>) => JSON.stringify(Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right)));

/**
 * Reads only the header and the first few data rows for display.
 *
 * `parseCsv` on the whole file would be a second full pass purely to render three lines. At the
 * 20,000 rows LA-2.2 criterion 6 asks for, that pass is the browser's memory problem — so the
 * sample is sliced off the text before it is parsed, not after.
 */
function previewCsv(text: string, sampleRows = 3) {
  try {
    const lines = text.split(/\r?\n/);
    let taken = 0;
    let cut = lines.length;
    // Quoted fields may contain newlines, so a line is not always a row. Counting quotes tells us
    // when we are between rows rather than inside one; a naive slice would cut a record in half
    // and report a parse error on a perfectly good file.
    let open = false;
    for (let index = 0; index < lines.length; index++) {
      const quotes = (lines[index].match(/"/g) ?? []).length;
      if (quotes % 2 === 1) open = !open;
      if (open) continue;
      taken++;
      if (taken > sampleRows) { cut = index + 1; break; }
    }
    const rows = parseCsv(lines.slice(0, cut).join("\n"));
    return { headers: rows[0] ?? [], rows: rows.slice(1, sampleRows + 1), error: null as string | null };
  } catch (error) {
    return { headers: [] as string[], rows: [] as string[][], error: error instanceof Error ? error.message : "This file could not be previewed" };
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, "").trim().toLocaleLowerCase();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "1961-05-06" \u2192 "6 May 1961": how each reading of an ambiguous date is said on the date choice. */
function spokenDate(iso: string | null) {
  if (!iso) return "not a date";
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** The file badge on the file line (board LinB2): what kind of file it is, in three or four letters. */
const fileKind = (name: string) => (/\.xlsx?$/i.test(name) ? "XLSX" : "CSV");

/** CSV as the browser reports it: Windows labels a .csv "application/vnd.ms-excel", and some send nothing. */
const CSV_TYPES = new Set(["", "text/csv", "text/plain", "application/csv", "application/vnd.ms-excel", "text/comma-separated-values"]);
/** Far above any 20,000-row list; a file this big is not one, and reading it would stall the tab. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Why a chosen file cannot be read as a lead list at all, before anything reads it; null when it can. */
function refuseFile(chosen: File): { title: string; detail: string } | null {
  if (/\.xls$/i.test(chosen.name)) return { title: "This is an old Excel file (.xls)", detail: "Save it as .xlsx or CSV, then choose it again." };
  if (!isXlsxFile(chosen) && !(/\.(csv|txt)$/i.test(chosen.name) || (!/\.[a-z0-9]{2,5}$/i.test(chosen.name) && CSV_TYPES.has(chosen.type))))
    return { title: `${chosen.name} is not a CSV or Excel file`, detail: "Export the list from the vendor's file as CSV or .xlsx." };
  if (chosen.size === 0) return { title: `${chosen.name} is empty`, detail: "Download it from the vendor again." };
  if (chosen.size > MAX_FILE_BYTES) return { title: `${chosen.name} is too big to read here`, detail: "Split it into files of 20,000 rows or fewer." };
  return null;
}

/**
 * A whole-file error from the parser, with the fix that matches it: the file, the lead form, or the
 * pipeline. Ends in a full stop either way (the parser's own messages do not).
 */
function fileErrorText(message: string, maxRows: number) {
  const said = /[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`;
  if (/cannot contain more than/i.test(message)) return `${said} Split it into files of ${maxRows.toLocaleString()} rows or fewer.`;
  if (/needs a header and at least one lead/i.test(message)) return `${said} Add the column names as the first row and at least one lead under them.`;
  if (/pipeline stage/i.test(message)) return `${said} Fix it in Settings › Pipelines & outcomes.`;
  if (/template|field labels/i.test(message)) return `${said} Fix the lead form in Settings › Products.`;
  return `${said} Correct the file and choose it again.`;
}

/**
 * Row 1 looks like a lead rather than column names: a header that is a phone number, an email or a
 * date. The importer would read that lead as the headers and map nothing.
 */
function looksHeaderless(headers: string[]) {
  return headers.some((raw) => {
    const value = raw.replace(/^\uFEFF/, "").trim();
    return /@/.test(value) || (value.replace(/\D/g, "").length >= 7 && /^[\d\s()+.-]+$/.test(value)) || /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(value);
  });
}

/**
 * The status icon at the end of a column row (owner 2026-10-28: an icon with a tooltip, not a word):
 * amber when a person must look, accent when placed, muted when the column is left out.
 */
function columnStatus(row: MappingRow, status: { label: string; detail: string; needsDecision: boolean } | undefined): { Icon: LucideIcon; text: string; tone: "warn" | "ok" | "muted" } {
  if (status?.needsDecision) return { Icon: CircleAlert, text: `${status.label === "Check this" ? "Check" : status.label} · ${status.detail}`, tone: "warn" };
  if (row.isStage) return { Icon: Flag, text: "Starting stage", tone: "ok" };
  if (!row.mapped) return { Icon: Ban, text: "Not imported", tone: "muted" };
  if (row.source === "saved") return { Icon: Bookmark, text: "From the saved map", tone: "ok" };
  if (row.source === "user") return { Icon: UserCheck, text: "Your choice", tone: "ok" };
  return { Icon: Check, text: row.confidence === "exact" ? "Same name" : `Matched · ${status?.detail ?? ""}`, tone: "ok" };
}

const STATUS_TONE = { warn: "text-[var(--warning-ink)]", ok: "text-[var(--accent-ink)]", muted: "text-[var(--muted)]" } as const;
/** The two section titles on this step share one, stronger style (owner 2026-10-28). */
const SECTION_TITLE = "text-card-title font-semibold text-[var(--ink)]";
/** The small-caps label at the start of each row of the import card (board LirI1: Into, Product, Paid). */
const ROW_LABEL = "w-20 shrink-0 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--body)]";
/** One row of the import card: its label, then its controls, wrapping on a narrow screen. */
const ROW = "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2";
/** One mapping row: their column and its sample | arrow | your field | status icon. */
const MAP_ROW = "grid min-w-0 grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_1.25rem] items-center gap-2 border-b border-[var(--border)] py-1 text-sm";

type ImportInfoResult = { ok: true; info: ImportInfo } | { ok: false; status: number; body: { error?: string; code?: string } | null };

/**
 * The import settings, per product ("" = the server's default). The last answer is kept for this tab,
 * so coming back to the step (or back to a product) draws at once while a fresh read replaces it;
 * a request already on its way is shared rather than sent twice.
 */
const infoCache = new Map<string, { info: ImportInfo; at: number }>();
const infoInFlight = new Map<string, Promise<ImportInfoResult>>();
/** An answer this young (the module's own early read, say) is used as it is, without a second request. */
const INFO_FRESH_MS = 5_000;
function requestImportInfo(product: string): Promise<ImportInfoResult> {
  const pending = infoInFlight.get(product);
  if (pending) return pending;
  const cached = infoCache.get(product);
  if (cached && Date.now() - cached.at < INFO_FRESH_MS) return Promise.resolve({ ok: true, info: cached.info });
  const request = fetch(`/api/app/leads/import${product ? `?product=${encodeURIComponent(product)}` : ""}`, { cache: "no-store" })
    .then(async (response): Promise<ImportInfoResult> => {
      const body = await response.json().catch(() => null);
      if (!response.ok) return { ok: false, status: response.status, body };
      infoCache.set(product, { info: body as ImportInfo, at: Date.now() });
      return { ok: true, info: body as ImportInfo };
    })
    .finally(() => infoInFlight.delete(product));
  infoInFlight.set(product, request);
  return request;
}
// Started as soon as this module runs on the import step, not after hydration and the first effect.
if (typeof window !== "undefined" && window.location.pathname === "/app/import") void requestImportInfo("").catch(() => undefined);

/**
 * Whether this tab can hold the file across the redirect to the review screen.
 *
 * Tested on mount rather than discovered on submit: the review is a separate route and the file
 * travels in `sessionStorage`, so a browser with site data blocked would otherwise find out only
 * after the scrub had already run. Cached, because `useSyncExternalStore` wants a stable snapshot.
 */
let storageProbe: boolean | null = null;
function sessionStorageWorks() {
  if (storageProbe !== null) return storageProbe;
  try {
    const key = `${IMPORT_CSV_KEY}:probe`;
    sessionStorage.setItem(key, "1");
    sessionStorage.removeItem(key);
    storageProbe = true;
  } catch {
    storageProbe = false;
  }
  return storageProbe;
}
const noSubscription = () => () => {};

const STATUS_SUFFIX: Record<string, string> = { draft: " · Draft", paused: " · Paused" };

type PreviewFields = Parameters<typeof previewLeadCsv>[1];

/**
 * The whole-file preview, memoised on the file and the mapping. With `dateOrder` null it is the
 * plain read (and finds the slash dates); with an order it is the read as the import will do it.
 * `enabled` false skips the pass, so a file with no slash dates is read once, not twice.
 */
function useLeadPreview(csv: string, stages: Array<{ id: string; name: string }> | undefined, fields: PreviewFields, mappingKey: string, dateOrder: ImportDateOrder | null, enabled: boolean) {
  return useMemo(
    () => (enabled && csv && stages ? previewLeadCsv(csv, fields, stages, JSON.parse(mappingKey) as Record<string, string | null>, 8, dateOrder) : null),
    [enabled, csv, stages, fields, mappingKey, dateOrder],
  );
}

/** `embedded`: drawn as a tab of Lead sources / Vendor bills (2026-10-26), whose header is the page's. */
export function LeadImportWorkspace({ embedded = false, readOnly = false }: {
  embedded?: boolean;
  /** The plan is read-only (paused, suspended, cancelled): the screen shows, the file is not checked. */
  readOnly?: boolean;
} = {}) {
  const [info, setInfo] = useState<ImportInfo | null>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [csv, setCsv] = useState("");
  const [saving, setSaving] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [costText, setCostText] = useState("");
  const [recordsText, setRecordsText] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The mapping (and date order) the person last confirmed with Looks right. Any change un-confirms it. */
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [pickedDateOrder, setPickedDateOrder] = useState<ImportDateOrder | null>(null);
  /** A quiet word when the vendor's map could not be saved on Continue. Never blocks the import. */
  const [saveNote, setSaveNote] = useState<string | null>(null);
  /** An Excel file is being read into CSV. */
  const [reading, setReading] = useState(false);
  /** Which worksheet of a multi-sheet workbook was read. */
  const [sheetNote, setSheetNote] = useState<string | null>(null);
  /** The import settings could not be read; the page offers a retry instead of loading forever. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** The agency sells no product yet (Settings › Products): the reason to show instead of the importer. */
  const [noProducts, setNoProducts] = useState<string | null>(null);
  /** The product's lead record, on demand rather than as a table under the form. */
  const [fieldsOpen, setFieldsOpen] = useState(false);
  /** "Your own book (no vendor)" is finding or creating its campaign. */
  const [ownBookBusy, setOwnBookBusy] = useState(false);
  /** The vendor (and campaign) were picked from the file's column names. */
  const [recognised, setRecognised] = useState(false);
  const router = useRouter();
  const storageOk = useSyncExternalStore(noSubscription, sessionStorageWorks, () => true);

  // Every one of these was recomputed on every render, including each keystroke in an unrelated
  // control, and each walked the whole file. They depend only on the file and the mapping, so they
  // are memoised on those. This is most of what criterion 6 actually needed.
  const preview = useMemo(() => previewCsv(csv), [csv]);
  const templateFields = useMemo(
    () => (info ? info.fields.map((field) => ({ field_key: field.key, label: field.label, type: field.type, is_required: field.required, options: field.options, sort_order: field.sort_order })) : []),
    [info],
  );
  const suggestions = useMemo(
    () => (csv && info ? suggestLeadCsvMappings(preview.headers.filter(Boolean), templateFields) : []),
    [csv, info, preview.headers, templateFields],
  );
  const saved = vendorId && info ? info.mappings.find((item) => item.vendor_id === vendorId) ?? null : null;
  const savedMapping = saved?.mapping ?? {};
  const savedDateOrder = isImportDateOrder(saved?.date_order) ? saved.date_order : null;
  const suggestedMapping = Object.fromEntries(suggestions.filter((item) => item.fieldKey).map((item) => [item.header, item.fieldKey]));
  const fileHeaders = new Set(suggestions.map((item) => item.header));
  const effectiveMapping = Object.fromEntries(Object.entries({ ...suggestedMapping, ...savedMapping, ...mapping }).filter(([header]) => fileHeaders.has(header)));
  const mappingKey = JSON.stringify(effectiveMapping);
  // One pass with no date order finds the slash dates; a second, only for files that have them,
  // counts rows as they will actually be read. A file with no slash dates is read once, as before.
  const baseValidation = useLeadPreview(csv, info?.stages, templateFields, mappingKey, null, true);
  const dates = baseValidation?.dates ?? EMPTY_DATE_SCAN;
  const datePicked = Boolean(pickedDateOrder ?? savedDateOrder);
  /** Sent with the file only when it has slash dates, so every other file's staged batch still matches. */
  const dateOrderToSend: ImportDateOrder | null = dates.slashDates > 0 ? pickedDateOrder ?? savedDateOrder ?? inferredImportDateOrder(dates) : null;
  const dateOrder: ImportDateOrder = dateOrderToSend ?? "mdy";
  const validation = useLeadPreview(csv, info?.stages, templateFields, mappingKey, dateOrderToSend, dateOrderToSend !== null) ?? baseValidation;
  const currentKey = `${mappingKey}|${dateOrderToSend ?? ""}`;

  const campaigns = info?.campaigns ?? [];
  const campaign = campaigns.find((item) => item.id === campaignId) ?? null;
  const vendorNameOf = (id: string) => info?.vendors.find((vendor) => vendor.id === id)?.name ?? "";
  // One picker, "Campaign · Vendor" (board LirI1): the vendor follows the campaign. A vendor picked
  // from the file's column names (or a campaign link) brings its own campaigns to the top.
  const visibleCampaigns = vendorId ? [...campaigns.filter((item) => item.vendor_id === vendorId), ...campaigns.filter((item) => item.vendor_id !== vendorId)] : campaigns;
  const campaignLabel = (item: { name: string; vendor_id: string; status: string }) => {
    const vendor = vendorNameOf(item.vendor_id);
    return `${item.name} · ${isOwnBookVendor(vendor) ? "No vendor" : vendor || "Vendor"}${STATUS_SUFFIX[item.status] ?? ""}`;
  };
  /** This tenant's own-book campaign, once it exists (lib/campaigns/ownBook.ts). */
  const ownBookCampaign = campaigns.find((item) => item.name === OWN_BOOK_CAMPAIGN_NAME && isOwnBookVendor(vendorNameOf(item.vendor_id))) ?? null;
  const requiredKeys = (info?.fields ?? []).filter((field) => field.required).map((field) => field.key);
  const mappedValues = new Set(Object.values(effectiveMapping).filter(Boolean));
  const requiredMapped = requiredKeys.filter((key) => mappedValues.has(key)).length;

  const fileRows = validation?.totalRows ?? 0;
  const cost = parseDollarsToCents(costText);
  const recordsValue = recordsText ?? (fileRows ? String(fileRows) : "");
  const records = parseRecordCount(recordsValue);

  // A hard cap already reached (leads this month, DNC lookups): the scrub would be refused, so it is said first.
  const usedUp = info?.limits.find((item) => ["monthly_leads_imported", "dnc_scrub_lookups"].includes(item.key) && !item.allowed) ?? null;

  // What stops the import whatever the person does here: said first, on the Next up line (2026-10-30).
  const hardBlock =
    readOnly ? "Your plan is read-only. Importing is paused until it is active again."
      : usedUp ? `Your plan's ${usedUp.label} are used up (${usedUp.usage.toLocaleString()} of ${(usedUp.limit ?? 0).toLocaleString()}).`
        : !storageOk ? "This browser will not hold the file between pages. Enable site data for this site to continue."
          : null;
  // Owner 2026-10-30: the campaign is the first thing asked, so the grey Continue never waits on it silently.
  const ownBookOffered = Boolean(info?.canCreateCampaigns || campaigns.some((item) => item.name === OWN_BOOK_CAMPAIGN_NAME));
  const campaignReason =
    campaign ? null
      : campaigns.length === 0 && !ownBookOffered ? "Every import goes into a campaign. Ask an owner or producer to create one."
        : "Choose where these leads go: a campaign, or your own book.";
  const paidReason =
    cost === "invalid" ? "Enter what you paid as dollars and cents, up to $1,000,000."
      : records === "invalid" ? "Enter rows bought as a whole number."
        : null;

  // `product`: the product the list is for (Settings › Products, 2026-10-28). Unnamed, the server picks
  // Term Life when the agency sells it, else the first product it sells.
  // A kept answer draws at once and the fresh read replaces it only when it differs, so the file is
  // not mapped and read again for nothing. `previous`: what to go back to when the product is refused.
  const latestProduct = useRef("");
  const loadInfo = useCallback((product?: string, previous?: ImportInfo | null) => {
    const key = product ?? "";
    latestProduct.current = key;
    setLoadFailed(false);
    setNoProducts(null);
    const cached = infoCache.get(key)?.info ?? null;
    if (cached) setInfo(cached);
    void requestImportInfo(key).then((result) => {
      if (latestProduct.current !== key) return;
      if (result.ok) {
        if (result.info !== cached) setInfo((current) => (current && JSON.stringify(current) === JSON.stringify(result.info) ? current : result.info));
        return;
      }
      const body = result.body;
      if (result.status === 409 && body?.code === "product_not_sold" && !product) { setNoProducts(body.error ?? "Choose the products your agency sells first."); return; }
      // A product with no lead form yet (or no longer sold): say so and stay on the product already open.
      if (result.status === 409 && product) {
        infoCache.delete(key);
        if (cached && previous) setInfo(previous);
        notify.block(body?.error ?? "That product cannot be imported yet.");
        return;
      }
      throw new Error(body?.error ?? "Could not load import settings");
    }).catch((error) => {
      if (latestProduct.current !== key) return;
      // A kept answer is still on screen: the page stays usable and only says the refresh failed.
      if (!cached) setLoadFailed(true);
      notify.fail("Could not load the import screen", { detail: error instanceof Error ? error.message : "Try again." });
    });
  }, []);
  /** Another product means another form: its fields and saved maps, so this file is mapped again. */
  function chooseProduct(code: string) {
    if (!code || code === info?.productCode) return;
    setMapping({});
    setConfirmedKey(null);
    setPickedDateOrder(null);
    loadInfo(code, info);
  }
  // The first read of the import settings; loadInfo owns the loading and failure state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadInfo(); }, [loadInfo]);

  useEffect(() => {
    if (!csv || !info || vendorId || preview.error) return;
    const headers = new Set(preview.headers.map(normalizeHeader).filter(Boolean));
    let best: SavedMap | null = null;
    let bestScore = 0;
    for (const item of info.mappings) {
      if (item.product_code !== info.productCode) continue;
      const keys = Object.keys(item.mapping);
      if (keys.length === 0) continue;
      const score = keys.filter((key) => headers.has(key)).length / Math.max(keys.length, headers.size);
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (!best || bestScore < 0.6) return;
    const vendor = best.vendor_id;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the recognition reads the file just chosen
    setVendorId(vendor);
    setRecognised(true);
    const live = info.campaigns.filter((item) => item.vendor_id === vendor && item.status === "active");
    if (live.length === 1) setCampaignId(live[0].id);
  }, [csv, info, vendorId, preview.error, preview.headers]);

  // `?campaign=<id>` (Lead sources › Source's "Import its list", 2026-10-29): that campaign and its
  // vendor are chosen once — and its product, when the link names one this agency sells — but only
  // when the campaign is one this person can import into (it is in the list the server sent).
  // Undefined: the address not read yet; null: nothing (more) to apply.
  const askedFor = useRef<{ campaign: string; product: string } | null | undefined>(undefined);
  useEffect(() => {
    if (!info) return;
    if (askedFor.current === undefined) {
      const params = new URLSearchParams(window.location.search);
      const campaign = params.get("campaign");
      askedFor.current = campaign ? { campaign, product: params.get("product") ?? "" } : null;
    }
    const asked = askedFor.current;
    if (!asked) return;
    const picked = info.campaigns.find((item) => item.id === asked.campaign);
    if (!picked) { askedFor.current = null; return; }
    if (asked.product && asked.product !== info.productCode && info.products?.some((product) => product.code === asked.product)) {
      // Another product's form first; this runs again when it arrives.
      const product = asked.product;
      askedFor.current = { ...asked, product: "" };
      loadInfo(product, info);
      return;
    }
    askedFor.current = null;
    setCampaignId(picked.id);
    setVendorId(picked.vendor_id);
  }, [info, loadInfo]);

  async function takeFile(chosen: File | undefined) {
    if (!chosen) return;
    const refused = refuseFile(chosen);
    if (refused) { notify.block(refused.title, { detail: refused.detail }); return; }
    // LA-2.2-1: an Excel file is read here, in the browser, into the same CSV text a CSV upload
    // gives — so every rule after this line (mapping, validation, scrub, dedupe) is the CSV path.
    let text: string;
    if (isXlsxFile(chosen)) {
      setReading(true);
      try {
        const read = await readXlsxAsCsv(await chosen.arrayBuffer());
        text = read.csv;
        setSheetNote(read.sheets > 1 ? `Read the worksheet “${read.sheetName}”, the first of ${read.sheets} with data. Save the others as their own files to import them.` : null);
      } catch (error) {
        notify.block("This Excel file could not be read", { detail: error instanceof Error ? error.message : "Save it again as .xlsx, or export it as CSV." });
        return;
      } finally {
        setReading(false);
      }
    } else {
      text = await chosen.text();
      setSheetNote(null);
    }
    setFile({ name: chosen.name, size: chosen.size });
    setCsv(text);
    setMapping({});
    setErrorsOpen(false);
    setRecordsText(null);
    setConfirmedKey(null);
    setPickedDateOrder(null);
    setSaveNote(null);
    setRecognised(false);
  }

  // Replace opens the picker straight away; Remove (×) just drops the file (2026-10-29 clean-up).
  const replaceInput = useRef<HTMLInputElement>(null);
  function reset() {
    setRecognised(false);
    setCsv(""); setFile(null); setMapping({}); setErrorsOpen(false); setRecordsText(null); setSheetNote(null);
    setConfirmedKey(null); setPickedDateOrder(null); setSaveNote(null);
  }

  // Choosing a vendor no longer throws away the columns the person mapped by hand: their choices
  // already outrank a saved map, and the new vendor's saved map still fills every column they did
  // not touch. If that changes the mapping, it is no longer the one confirmed, and the page says so.
  function chooseCampaign(value: string) {
    setCampaignId(value);
    // The vendor follows the campaign: a campaign belongs to exactly one vendor.
    const next = campaigns.find((item) => item.id === value);
    if (next && next.vendor_id !== vendorId) setVendorId(next.vendor_id);
  }

  /**
   * "Your own book (no vendor)" (board LirI1): the agency's own list goes into its own-book campaign.
   * Chosen at once when it exists; otherwise made by POST /api/app/campaigns/own-book (owners and
   * producers, as New campaign is) and added to the lists here, so nothing is read again.
   */
  async function chooseOwnBook() {
    if (ownBookCampaign) { chooseCampaign(ownBookCampaign.id); return; }
    if (!info?.canCreateCampaigns || readOnly) return;
    setOwnBookBusy(true);
    try {
      const response = await fetch("/api/app/campaigns/own-book", { method: "POST" });
      const body = await response.json().catch(() => null) as { campaign?: { id: string; vendor_id: string; name: string; status: string }; created?: boolean; error?: string } | null;
      const made = body?.campaign;
      if (!response.ok || !made) { notify.block("Could not set up your own book", { detail: body?.error ?? "The server refused it." }); return; }
      // The import lists drafts, active and paused campaigns; an exhausted one cannot take a list.
      if (made.status === "exhausted") { notify.block(`${made.name} is marked exhausted`, { detail: "Reopen it on Lead sources › Source, then import into it." }); return; }
      infoCache.clear();
      setInfo((current) => current ? {
        ...current,
        vendors: current.vendors.some((vendor) => vendor.id === made.vendor_id)
          ? current.vendors.map((vendor) => vendor.id === made.vendor_id ? { ...vendor, status: "active" } : vendor)
          : [...current.vendors, { id: made.vendor_id, name: OWN_BOOK_VENDOR_NAME, lead_type: "list", status: "active" }],
        campaigns: current.campaigns.some((item) => item.id === made.id) ? current.campaigns : [...current.campaigns, made],
      } : current);
      setCampaignId(made.id);
      setVendorId(made.vendor_id);
      setRecognised(false);
    } catch {
      notify.fail("Could not set up your own book", { detail: "Try again." });
    } finally {
      setOwnBookBusy(false);
    }
  }

  /** Saves this map as the vendor's. `quiet` is the Continue path: a failure is a note, not a stop. */
  async function saveMapping(quiet = false) {
    const vendorName = info?.vendors.find((vendor) => vendor.id === vendorId)?.name ?? "this vendor";
    try {
      const response = await fetch("/api/app/leads/import/mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_id: vendorId, product_code: info?.productCode, mapping: effectiveMapping, ...(pickedDateOrder ? { date_order: pickedDateOrder } : {}) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (quiet) setSaveNote(`This map was not saved as ${vendorName}'s: ${body?.error ?? "the server refused it"}. The import goes ahead with it anyway.`);
        else notify.block("Could not save the mapping", { detail: body?.error ?? "The server refused it." });
        return;
      }
      setSaveNote(typeof body?.note === "string" ? body.note : null);
      if (!quiet) notify.done("Vendor mapping saved");
      setInfo((current) => current ? { ...current, mappings: [...current.mappings.filter((item) => item.vendor_id !== vendorId), body.mapping] } : current);
    } catch {
      if (quiet) setSaveNote(`This map was not saved as ${vendorName}'s: the connection dropped. The import goes ahead with it anyway.`);
      else notify.fail("Could not save the mapping", { detail: "Try again." });
    }
  }

  /** The vendor's saved map is exactly this one (date order included), so there is nothing to save. */
  const mapUnchanged = Boolean(saved && mapKey(saved.mapping) === mapKey(effectiveMapping) && (!pickedDateOrder || pickedDateOrder === savedDateOrder));

  /**
   * Looks right (board LinB2): confirm the columns and keep them as the vendor's map when they
   * changed, so the next file from them maps itself. The scrub runs from Continue to review.
   */
  async function confirmColumns() {
    setConfirmedKey(currentKey);
    if (vendorId && !mapUnchanged) await saveMapping(true);
  }

  /**
   * Module 2 §6 · stage the file, then hand the decision to a human.
   *
   * The server runs steps ④⑤⑥, writes nothing, and this redirects to the review screen where the
   * choices actually live.
   */
  async function importFile(event: React.FormEvent) {
    event.preventDefault();
    if (blockedReason) return;
    await runPreflight();
  }

  async function runPreflight() {
    if (!campaign) return;
    setSaving(true);
    try {
      const response = await fetch("/api/app/leads/import/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          product_code: info?.productCode,
          campaign_id: campaign.id,
          vendor_id: campaign.vendor_id,
          mapping: Object.keys(effectiveMapping).length ? effectiveMapping : undefined,
          file_name: file?.name.slice(0, 255) || undefined,
          cost_cents: typeof cost === "number" ? cost : null,
          records_purchased: typeof records === "number" ? records : null,
          date_order: dateOrderToSend ?? undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const batchId = typeof body?.batchId === "string" ? body.batchId : null;
        notify.block("Could not check this file", {
          detail: body?.error ?? "The file could not be read.",
          action: response.status === 409 && batchId ? { label: "Open it", onClick: () => router.push(`/app/import/review/${batchId}`) }
            : body?.code === "limit_reached" ? { label: "See plans", onClick: () => router.push("/app/settings#billing") }
              : undefined,
        });
        return;
      }
      // The file itself travels in the tab, not in the URL or the staged row. See the bridge for
      // why.
      try { sessionStorage.setItem(`${IMPORT_CSV_KEY}:${body.batchId}`, csv); }
      catch { notify.block("This browser will not hold the file between pages", { detail: "Check that site data is enabled." }); return; }
      router.push(`/app/import/review/${body.batchId}`);
    } catch {
      notify.fail("The file could not be checked", { detail: "Try again." });
    } finally {
      setSaving(false);
    }
  }

  const usage = info?.limits.filter((item) => ["monthly_leads_imported", "dnc_scrub_lookups"].includes(item.key)) ?? [];
  const firstRow = preview.rows[0] ?? [];
  const sampleFor = (header: string) => {
    const index = preview.headers.findIndex((raw) => normalizeHeader(raw) === header);
    return index >= 0 ? firstRow[index] ?? "" : "";
  };
  // Every column in the file, the stage column included, in the file's order.
  const mappingRows: MappingRow[] = suggestions.map((item) => ({
    header: item.header,
    firstValue: sampleFor(item.header),
    mapped: item.header === "stage" ? null : effectiveMapping[item.header] ?? null,
    source: item.header in mapping ? "user" : item.header in savedMapping ? "saved" : "suggested",
    confidence: item.confidence,
    isStage: item.header === "stage",
  }));
  const mappingFields = useMemo(() => (info?.fields ?? []).map((field) => ({ key: field.key, label: field.label, type: field.type, required: field.required })), [info]);
  const mappingSummary = columnMappingStatus({ rows: mappingRows, fields: mappingFields, dates, dateOrder, datePicked });
  const vendorName = info?.vendors.find((vendor) => vendor.id === vendorId)?.name ?? null;
  const canMap = Boolean(csv && info && mappingRows.length > 0 && !preview.error);
  // Confirmed with Continue, or ready on its own: every column placed and nothing to decide (board C).
  const mapConfirmed = confirmedKey === currentKey || (mappingRows.length > 0 && mappingSummary.needsDecision === 0 && !mappingSummary.blockedReason);
  // One reason, shown under the button, for why it cannot be pressed yet — never a silent grey.
  // Two columns on one field is the map's to fix, not the file's: the columns card says it, so the
  // parser's whole-file error for it is not repeated as "correct the file".
  const fileError = preview.error ?? (validation?.error && !(mappingSummary.blockedReason && /same field/i.test(validation.error)) ? validation.error : null);
  // In the owner's order (2026-10-30): what blocks everything, where the leads go, the file, its
  // columns, then what was paid. The first one found is the Next up line and the grey button's reason.
  const columnsToCheck = mappingSummary.needsDecision;
  type Step = { tone: NextUpTone; reason: string };
  const nextStep: Step | null =
    !info ? { tone: "action", reason: "Loading the import settings…" }
      : hardBlock ? { tone: "danger", reason: hardBlock }
        : campaignReason ? { tone: campaigns.length === 0 && !ownBookOffered ? "warning" : "action", reason: campaignReason }
          : reading ? { tone: "action", reason: "Reading the workbook…" }
            : !csv ? { tone: "action", reason: vendorName && isOwnBookVendor(vendorName) ?"Drop your list, as a CSV or Excel file." : "Drop the vendor’s file, as it arrived." }
              : fileError ? { tone: "danger", reason: fileErrorText(fileError, info.maxRows) }
                : mappingSummary.blockedReason ? { tone: "warning", reason: mappingSummary.blockedReason }
                  : !mapConfirmed ? { tone: "action", reason: columnsToCheck > 0 ? `Check the ${columnsToCheck.toLocaleString()} column${columnsToCheck === 1 ? "" : "s"} we couldn't match, then press Looks right.` : "Check the columns, then press Looks right." }
                    : (validation?.validRows ?? 0) === 0 ? { tone: "danger", reason: "Fix the file: no row can be imported as it is." }
                      : paidReason ? { tone: "action", reason: paidReason }
                        : null;
  const blockedReason = nextStep?.reason ?? null;

  if (noProducts) {
    return (
      <DashedCard icon={<Store className="size-4" aria-hidden />} title="Choose the products you sell first" action={<Button asChild variant="outline"><Link href="/app/settings#products">Open Settings › Products</Link></Button>}>
        Every imported lead is for a product your agency sells.
      </DashedCard>
    );
  }
  if (!info && !loadFailed) return <PageLoading rows={6} />;

  // Board LirI1 (owner pick 2026-10-29, Leads in round 3): one card, Into (the campaign, or your own
  // book, or a new campaign), Product, then the drop zone, which holds the file once it is dropped.
  // The columns follow (asking only when one needs a person), and the frame's corner holds the one
  // way on, Continue to Review. Nothing is written until the review's Import.
  const ownBookLabel = vendorName && isOwnBookVendor(vendorName);
  const columnsNeedYou = canMap && !mapConfirmed;
  // Looks right has been pressed for this exact map, or the vendor's saved map already is it and
  // nothing needs a person: either way the button has become its answer (board LinB2).
  const columnsSettled = confirmedKey === currentKey || (Boolean(vendorId) && mapUnchanged && mappingSummary.needsDecision === 0 && !mappingSummary.blockedReason);
  const savedFits = saved ? preview.headers.map(normalizeHeader).filter((header) => header && header in saved.mapping).length : 0;
  const ambiguousDate = dates.firstAmbiguous;
  const dateReadings = ambiguousDate ? slashDateReadings(ambiguousDate) : null;

  // The plan's monthly figures, behind a small icon beside the file (owner 2026-10-28: no foot bar).
  const usageTip = usage.length > 0 && <InfoTip label="This month's usage" side="bottom">
    <span className="flex flex-col gap-0.5 tabular-nums">
      {usage.map((item) => <span key={item.key}>{item.key === "dnc_scrub_lookups" ? "Do Not Call checks" : item.label} {item.usage.toLocaleString()}{item.limit === null ? "" : ` of ${item.limit.toLocaleString()}`}</span>)}
    </span>
  </InfoTip>;

  // The step's one way on (owner 2026-10-30): the Next up line's button, the page's only primary. It
  // is the form's submit through `form=`, so it checks the file and opens the review as it always did.
  // Grey, it carries its reason: the sentence beside it says it, and so do its title and description.
  const continueNote = blockedReason
    ? `Continue to Review is waiting: ${blockedReason}`
    : `Checks Do Not Call, litigators, duplicates and phone numbers for ${(validation?.validRows ?? fileRows).toLocaleString()} rows, then opens the review. Nothing is written yet.`;
  const continueControl = <span className="inline-flex items-center" title={continueNote}>
    <span id="import-continue-note" className="sr-only">{continueNote}</span>
    <Button type="submit" form="lead-import-form" disabled={Boolean(blockedReason) || saving} aria-describedby="import-continue-note">
      {saving ? "Checking…" : <>Continue to Review<ArrowRight aria-hidden /></>}
    </Button>
  </span>;
  const readyRows = validation?.validRows ?? 0;
  const leftOut = validation?.rejectedRows ?? 0;
  // Used up: the way on is the plan, not the review, so that is the line's one button.
  const nextUp = info && (nextStep
    ? <NextUp
        tone={nextStep.tone}
        action={!readOnly && usedUp ? <Button asChild><Link href="/app/settings#billing">See plans</Link></Button> : continueControl}
      >
        {nextStep.reason}
      </NextUp>
    : <NextUp tone="action" action={continueControl}>
        <strong>{readyRows.toLocaleString()}</strong> row{readyRows === 1 ? "" : "s"} ready{leftOut > 0 ? `, ${leftOut.toLocaleString()} left out` : ""}. Continue to Review.
      </NextUp>);

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
    {!embedded && <PageHeader title="Import leads" />}
    {nextUp}

    {loadFailed && !info && <p role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--error)]/30 bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">
      The import settings could not be loaded.
      <Button type="button" variant="outline" onClick={() => loadInfo()}>Try again</Button>
    </p>}

    <form id="lead-import-form" onSubmit={importFile} className="flex min-w-0 flex-col gap-4">
      {/* Board LirI1: one card. Into, Product, then the drop zone that holds the file. */}
      <Card role="region" aria-label="The list" className="min-w-0 gap-3.5 p-4.5">
        <div className={ROW}>
          <label htmlFor="lead-campaign" className={ROW_LABEL}>Into</label>
          <select id="lead-campaign" className={cn(inputControl, "w-auto min-w-0 flex-1 sm:max-w-[420px]")} required value={campaignId} disabled={campaigns.length === 0} onChange={(event) => chooseCampaign(event.target.value)}>
            <option value="">{campaigns.length === 0 ? "No campaign yet" : "Choose a campaign"}</option>
            {visibleCampaigns.map((item) => <option key={item.id} value={item.id}>{campaignLabel(item)}</option>)}
          </select>
          {/* An assistant cannot make the own-book campaign, but can choose it once it exists. */}
          {(ownBookCampaign || info?.canCreateCampaigns) && <>
            <span className="text-xs text-[var(--body)]">or</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={Boolean(ownBookLabel)}
              disabled={ownBookBusy || (!ownBookCampaign && readOnly)}
              title={!ownBookCampaign && readOnly ? "Your plan is read-only." : "For your own clients, old leads or referrals: a list with no vendor."}
              onClick={() => void chooseOwnBook()}
            >
              <BookUser aria-hidden />{ownBookBusy ? "Setting up…" : "Your own book (no vendor)"}
            </Button>
          </>}
          {info?.canCreateCampaigns && <Button asChild variant="outline" size="sm">
            <Link href="/app/campaigns?guide=campaign"><Plus aria-hidden />New campaign</Link>
          </Button>}
        </div>
        {/* What the Into row still needs said, under the picker. */}
        {info && (campaigns.length === 0 || recognised || (campaign && campaign.status !== "active")) && <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[1.5] text-[var(--body)] sm:pl-23">
          {campaigns.length === 0 && <span role="status">
            {info.canCreateCampaigns
              ? "Create a campaign to continue, or import your own book. Every import goes into a campaign."
              : "Every import goes into a campaign. Ask an owner or producer to create one."}
          </span>}
          {recognised && vendorName && <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5 text-[var(--accent-ink)]" aria-hidden />Recognised as {ownBookLabel ? "your own book" : `${vendorName}'s file`} from its column names</span>}
          {campaign && campaign.status !== "active" && <span className="text-[var(--warning-ink)]">Activate it to dial these leads — it is {campaign.status}.</span>}
        </p>}

        {/* Settings › Products (2026-10-28): the list is for one product the agency sells; its form decides the columns. */}
        <div className={ROW}>
          <label htmlFor="lead-product" className={ROW_LABEL}>Product</label>
          <select id="lead-product" className={cn(inputControl, "w-auto min-w-0 flex-1 sm:max-w-[240px]")} required value={info?.productCode ?? ""} disabled={(info?.products?.length ?? 0) < 2} onChange={(event) => chooseProduct(event.target.value)}>
            {(info?.products ?? []).map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
          </select>
        </div>

        {/* The drop zone. Before a file: the target. After it: the file, and a drop here replaces it. */}
        <div
          className={cn("flex min-h-[220px] min-w-0 flex-col items-center justify-center gap-2.5 rounded-[14px] border-2 border-dashed px-6 py-8 text-center transition-colors", dragging ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--primary)_4%,transparent)]")}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void takeFile(event.dataTransfer.files?.[0]); }}
        >
          <input id="lead-csv" ref={replaceInput} className="peer sr-only" type="file" accept={`.csv,text/csv,${XLSX_TYPES}`} disabled={reading} onChange={(event) => { void takeFile(event.target.files?.[0]); event.target.value = ""; }} />
          {file
            ? <>
                <span className="flex min-w-0 max-w-full items-center gap-2.5 motion-safe:animate-[m-rise_.3s_cubic-bezier(.2,.8,.2,1)_both]">
                  <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--primary-soft)] text-xs font-extrabold text-[var(--accent-ink)]">{fileKind(file.name)}</span>
                  <strong className="min-w-0 truncate text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{file.name}</strong>
                </span>
                <span className="flex min-w-0 max-w-full items-center gap-1 text-sm leading-[1.5] text-[var(--ink)] tabular-nums">
                  <span className="truncate" title={`${preview.headers.length} columns · ${formatBytes(file.size)}${saved ? ` · the saved map fits ${savedFits.toLocaleString()} of ${preview.headers.length.toLocaleString()} headers` : ""}`}>
                    {reading ? "Reading the workbook…" : <>{fileRows.toLocaleString()} rows · {saved
                      ? `${savedFits < preview.headers.length ? `${savedFits.toLocaleString()} of ${preview.headers.length.toLocaleString()} ` : ""}columns matched from the saved ${ownBookLabel ? "own-book" : vendorName} map`
                      : `${preview.headers.length} columns · ${formatBytes(file.size)}`}</>}
                  </span>
                  {usageTip}
                </span>
                {sheetNote && <span className="text-xs leading-[1.5] text-[var(--body)]">{sheetNote}</span>}
                <span className="flex flex-wrap items-center justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={reading} onClick={() => replaceInput.current?.click()}>Replace file</Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${file.name}`} title="Remove file" disabled={reading} onClick={reset}><X aria-hidden="true" />Remove</Button>
                </span>
                {/* What the browser could already read from the file; the scrub's answer comes on the review. */}
                {fileError
                  ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{fileErrorText(fileError, info?.maxRows ?? 20000)}</p>
                  : validation && validation.rejectedRows > 0 && <span className="flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--body)]">
                      <StatusChip tone="warning" dot>{validation.rejectedRows.toLocaleString()} row{validation.rejectedRows === 1 ? " needs" : "s need"} attention · left out</StatusChip>
                      {validation.rowErrors.length > 0 && <Button type="button" variant="ghost" size="sm" aria-expanded={errorsOpen} onClick={() => setErrorsOpen((open) => !open)}>
                        {errorsOpen ? "Hide" : "See which"}<ChevronDown className={cn("size-4 transition-transform", errorsOpen && "rotate-180")} aria-hidden />
                      </Button>}
                    </span>}
                {!fileError && looksHeaderless(preview.headers) && <p role="alert" className="m-0 text-sm text-[var(--warning-ink)]">Row 1 looks like a lead, not column names, so it would be lost. Add a header row and choose the file again.</p>}
                {errorsOpen && validation && validation.rowErrors.length > 0 && <ul className="m-0 flex w-full max-w-2xl list-none flex-col gap-1 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-sm leading-[1.5] text-[var(--ink)]">
                  {validation.rowErrors.map((item) => <li key={item.rowNumber}>{item.message}</li>)}
                  {validation.moreRowErrors > 0 && <li>and {validation.moreRowErrors.toLocaleString()} more row{validation.moreRowErrors === 1 ? "" : "s"} with problems</li>}
                </ul>}
              </>
            : <>
                <Upload className="size-10 text-[var(--accent-ink)]" strokeWidth={1.6} aria-hidden />
                <p className="m-0 text-base font-semibold tracking-[-0.02em] text-[var(--ink)]">{ownBookLabel ? "Drop your list here" : "Drop the vendor’s file here"}</p>
                <p className="m-0 flex max-w-[520px] items-center gap-1 text-sm leading-[1.5] text-[var(--ink)]">{reading ? "Reading the workbook…" : `CSV or Excel, as it arrived. No editing first. Up to ${(info?.maxRows ?? 20000).toLocaleString()} rows.`}{usageTip}</p>
                <span className="flex flex-wrap items-center justify-center gap-2">
                  <Button data-guide="lead-import-upload" asChild variant="outline" size="sm" className="cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
                    <label htmlFor="lead-csv">Choose a file</label>
                  </Button>
                  {info && info.fields.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setFieldsOpen(true)}>Which columns we read</Button>}
                </span>
              </>}
        </div>

        {/* What the list cost, once there is a list: "Paid $4,500.00 for 1,000 rows bought". Both optional. */}
        {file && <div className={ROW}>
          <label htmlFor="lead-cost" className={ROW_LABEL}>Paid</label>
          <span className="relative block w-40">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--body)]">$</span>
            <input id="lead-cost" className={cn(inputControl, "pl-7 tabular-nums", cost === "invalid" && "border-[var(--error)]")} inputMode="decimal" autoComplete="off" placeholder="Optional" value={costText} onChange={(event) => setCostText(event.target.value)} aria-invalid={cost === "invalid" || undefined} aria-describedby={cost === "invalid" ? "lead-cost-error" : undefined} />
          </span>
          <label htmlFor="lead-records" className="text-sm text-[var(--ink)]">for</label>
          <input id="lead-records" className={cn(inputControl, "w-28 tabular-nums", records === "invalid" && "border-[var(--error)]")} inputMode="numeric" autoComplete="off" placeholder={fileRows ? fileRows.toLocaleString() : undefined} value={recordsValue} onChange={(event) => setRecordsText(event.target.value)} aria-invalid={records === "invalid" || undefined} aria-describedby={records === "invalid" ? "lead-records-error" : undefined} />
          <span className="text-sm text-[var(--ink)]">rows bought</span>
          {cost === "invalid" && <span id="lead-cost-error" role="alert" className="text-xs text-[var(--error-ink)]">What you paid: like 4,500.00, up to $1,000,000.</span>}
          {records === "invalid" && <span id="lead-records-error" role="alert" className="text-xs text-[var(--error-ink)]">Rows bought: a whole number.</span>}
        </div>}
      </Card>

      {/* Board LinB2, compact (owner 2026-10-28): every column theirs → yours, two to a line on a wide
          screen, each destination still changeable, its state an icon with the reason on hover. */}
      {canMap && <Card role="region" aria-label="Columns" className="min-w-0 gap-2 px-4 py-3">
        <span className="flex min-h-[2.25rem] min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <strong className={cn(SECTION_TITLE, "shrink-0")}>Their columns → your fields</strong>
          <span className={cn("min-w-0 flex-1 truncate text-xs leading-[1.5] tabular-nums", columnsNeedYou || mappingSummary.blockedReason ? "text-[var(--warning-ink)]" : "text-[var(--body)]")}>
            {mappingSummary.blockedReason ?? (columnsNeedYou ? `${mappingSummary.needsDecision.toLocaleString()} to check before checking phone numbers` : `${mappingSummary.mapped.toLocaleString()} of ${mappingRows.length.toLocaleString()} placed · ${requiredMapped} of ${requiredKeys.length} required${dateOrderToSend ? ` · dates ${dateOrderToSend === "dmy" ? "day first" : "month first"}` : ""}`)}
          </span>
          {!vendorId && <InfoTip label="About keeping this map">Choose the campaign above to keep this map for its vendor’s next file.</InfoTip>}
          {columnsSettled
            ? <span role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-ink)]"><Check className="size-4" aria-hidden />{vendorId && mapUnchanged ? `Saved for ${vendorName}'s next file` : "Columns checked"}</span>
            : <Button type="button" variant="outline" disabled={Boolean(mappingSummary.blockedReason)} title={mappingSummary.blockedReason ?? undefined} onClick={() => void confirmColumns()}>Looks right</Button>}
        </span>
        <ul className="m-0 grid min-w-0 list-none gap-x-6 p-0 xl:grid-cols-2">
          {mappingRows.map((row) => {
            const status = mappingSummary.statuses.get(row.header);
            const { Icon, text, tone } = columnStatus(row, status);
            return <li key={row.header} className={MAP_ROW}>
              <span className="flex min-w-0 items-baseline gap-2">
                <strong className="max-w-[60%] shrink-0 truncate font-semibold text-[var(--ink)]" title={row.header}>{row.header}</strong>
                {row.firstValue && <span className="min-w-0 truncate text-xs text-[var(--body)]" title={row.firstValue}>{row.firstValue}</span>}
              </span>
              <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden />
              {row.isStage
                ? <span className="truncate text-[var(--body)]">Each lead&apos;s starting stage</span>
                : <select aria-label={`Map ${row.header}`} className={cn(inputControl, !row.mapped && "text-[var(--body)]", tone === "warn" && "border-[var(--warning)]")} value={row.mapped ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [row.header]: event.target.value || null }))}>
                    <option value="">Not imported</option>
                    {mappingFields.map((field) => <option key={field.key} value={field.key}>{field.label}{field.required ? " (required)" : ""}</option>)}
                  </select>}
              <span role="img" aria-label={text} title={text} className={cn("inline-flex justify-center", STATUS_TONE[tone])}><Icon className="size-4" aria-hidden /></span>
            </li>;
          })}
          {mappingSummary.missingRequired.map((field) => <li key={`missing-${field.key}`} className={cn(MAP_ROW, "bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]")}>
            <span className="truncate text-[var(--body)]">No column</span>
            <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden />
            <span className="truncate text-[var(--ink)]">{field.label}</span>
            <span role="img" aria-label="Required · pick its column" title="Required · pick its column" className={cn("inline-flex justify-center", STATUS_TONE.warn)}><CircleAlert className="size-4" aria-hidden /></span>
          </li>)}
        </ul>
        {dates.ambiguous > 0 && ambiguousDate && dateReadings && <Callout
          tone="warning"
          className="mt-2"
          title={dates.firstUnambiguous ? `${dates.firstUnambiguous} is unambiguous. ${ambiguousDate} is not.` : `${ambiguousDate} can be read two ways`}
        >
          <fieldset className="m-0 flex min-w-0 flex-wrap gap-3 border-0 p-0">
            <legend className="mb-2 text-sm text-[var(--body)]">One format for all {dates.ambiguous.toLocaleString()} date{dates.ambiguous === 1 ? "" : "s"} in this file</legend>
            {([["mdy", "Month first (US)", dateReadings.mdy], ["dmy", "Day first", dateReadings.dmy]] as const).map(([order, label, reading]) => {
              const checked = datePicked && dateOrder === order;
              return <label key={order} htmlFor={`date-order-${order}`} className={cn("flex min-w-[220px] flex-1 cursor-pointer items-start gap-2.5 rounded-[8px] border bg-[var(--surface)] px-3 py-2.5", checked ? "border-[var(--primary)]" : "border-[var(--border-strong)]")}>
                <input id={`date-order-${order}`} type="radio" name="date-order" className="mt-1 accent-[var(--primary)]" checked={checked} onChange={() => setPickedDateOrder(order)} />
                <span className="min-w-0">
                  <span className="block text-sm leading-[1.5] font-semibold text-[var(--ink)]">{label}</span>
                  <span className="block text-xs leading-[1.5] text-[var(--body)] tabular-nums">{ambiguousDate} = {spokenDate(reading)}</span>
                </span>
              </label>;
            })}
          </fieldset>
          {savedDateOrder && vendorName && savedDateOrder === dateOrder && <p className="m-0 mt-2 text-xs leading-[1.5] text-[var(--body)]">Using {vendorName}&rsquo;s saved date format</p>}
        </Callout>}
        {saveNote && <p role="status" className="m-0 text-xs leading-[1.5] text-[var(--body)]">{saveNote}</p>}
      </Card>}

      {/* Read-only, used up and a browser that will not hold the file are said once, on the Next up
          line at the top; Continue to Review lives there too, in and out of the Lead sources frame. */}
    </form>

    {info && info.fields.length > 0 && <Dialog open={fieldsOpen} onOpenChange={setFieldsOpen}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Expected fields</DialogTitle>
          <DialogDescription>The details Insurvas can read for {info.product.name} leads.</DialogDescription>
          <Button type="button" variant="outline" onClick={() => downloadFieldTemplate(info.fields)}>Download sample CSV</Button>
        </DialogHeader>
        <PagedProvider>
        <TableCard className="max-h-[60dvh] min-w-0 overflow-y-auto">
      <table className={st.table}>
        <thead><tr className={st.headRow}><th scope="col" className={st.th}>Field</th><th scope="col" className={st.th}>Type</th><th scope="col" className={st.th}>Required</th></tr></thead>
        <PagedBody>
          {info.fields.map((field) => <tr key={field.key}>
            <td className={st.td}>{field.label}</td>
            <td className={st.td}>{TEMPLATE_FIELD_TYPE_LABELS[field.type]}</td>
            <td className={st.td}>{field.required ? "Required" : "Optional"}</td>
          </tr>)}
        </PagedBody>
      </table>
          {info.fields.length > 10 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <PagedPager total={info.fields.length} noun="fields" />
            </div>
          )}
        </TableCard>
        </PagedProvider>
      </DialogContent>
    </Dialog>}
  </div>;
}
