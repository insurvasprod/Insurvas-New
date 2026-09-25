"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarCheck, CheckCircle2, ChevronDown, FileText, Info, RefreshCw, Store, Upload } from "lucide-react";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { Callout, DashedCard, Field, Pill, SettingsCard, SettingsMeter, btn, control, st } from "@/components/app/settings/primitives";
import { ImportStepper, type ImportStep } from "@/components/app/import-stepper";
import { ColumnMappingDialog, columnMappingStatus, type MappingRow } from "@/components/app/column-mapping-dialog";
import { sectionForPath } from "@/lib/menu/definition";
import { EMPTY_DATE_SCAN, inferredImportDateOrder, isImportDateOrder, parseCsv, previewLeadCsv, suggestLeadCsvMappings, type ImportDateOrder } from "@/lib/agentTemplates/csv";
import { IMPORT_CSV_KEY, parseDollarsToCents, parseRecordCount } from "@/lib/agentTemplates/importReviewModel";
import type { TemplateFieldType } from "@/lib/templates/constants";
import { cn } from "@/lib/utils";

type SavedMap = { id: string; vendor_id: string; product_code: string; mapping: Record<string, string | null>; updated_at: string; date_order?: ImportDateOrder | null };
type ImportInfo = { product: { name: string }; productCode: string; fields: Array<{ key: string; label: string; type: TemplateFieldType; required: boolean; options: string[]; sort_order: number }>; stages: Array<{ id: string; name: string }>; campaigns: Array<{ id: string; vendor_id: string; name: string; status: string }>; vendors: Array<{ id: string; name: string; lead_type: string; status: string }>; mappings: SavedMap[]; limits: Array<{ key: string; label: string; usage: number; limit: number | null; hardCap: boolean; allowed: boolean }>; maxRows: number; canCreateCampaigns?: boolean };

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

export function LeadImportWorkspace() {
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
  // The mapping dialog. Its choices live here, so closing it never loses one.
  const [mapOpen, setMapOpen] = useState(false);
  /** The mapping (and date order) the person last confirmed with Continue. Any change un-confirms it. */
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [pickedDateOrder, setPickedDateOrder] = useState<ImportDateOrder | null>(null);
  /** A quiet word when the vendor's map could not be saved on Continue. Never blocks the import. */
  const [saveNote, setSaveNote] = useState<string | null>(null);
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
  const mapConfirmed = confirmedKey === currentKey;

  const campaigns = info?.campaigns ?? [];
  const activeVendors = info?.vendors.filter((vendor) => vendor.status === "active") ?? [];
  const campaign = campaigns.find((item) => item.id === campaignId) ?? null;
  const visibleCampaigns = vendorId ? campaigns.filter((item) => item.vendor_id === vendorId) : campaigns;
  const requiredKeys = (info?.fields ?? []).filter((field) => field.required).map((field) => field.key);
  const mappedValues = new Set(Object.values(effectiveMapping).filter(Boolean));
  const requiredMapped = requiredKeys.filter((key) => mappedValues.has(key)).length;

  const fileRows = validation?.totalRows ?? 0;
  const cost = parseDollarsToCents(costText);
  const recordsValue = recordsText ?? (fileRows ? String(fileRows) : "");
  const records = parseRecordCount(recordsValue);

  // What the page itself still needs, apart from the mapping — said on the dialog before Continue.
  const pageReason =
    campaigns.length === 0 ? "Create a campaign first."
      : !campaign ? "Choose the campaign this list belongs to."
        : cost === "invalid" ? "Enter the batch cost as dollars and cents, up to $1,000,000."
          : records === "invalid" ? "Enter rows purchased as a whole number."
            : !storageOk ? "This browser will not hold the file between pages."
              : null;
  // One reason, shown under the button, for why it cannot be pressed yet — never a silent grey.
  const blockedReason =
    !csv ? "Choose a CSV file first."
      : !info ? "Loading the import settings…"
        : validation?.error ? "Correct the file and choose it again."
          : !mapConfirmed ? "Confirm the column mapping first: use Map columns."
            : (validation?.validRows ?? 0) === 0 ? "No row in this file can be imported as it is."
              : pageReason;
  // Upload until the mapping is open or confirmed; Scrub from a confirmed mapping onwards.
  const step: ImportStep = !csv ? 1 : saving ? 3 : mapOpen && info && !preview.error ? 2 : mapConfirmed ? 3 : 1;

  useEffect(() => {
    void fetch("/api/app/leads/import", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load import settings");
      setInfo(body);
    }).catch((error) => notify.fail("Could not load the import screen", { detail: error.message }));
  }, []);

  async function takeFile(chosen: File | undefined) {
    if (!chosen) return;
    setFile({ name: chosen.name, size: chosen.size });
    setCsv(await chosen.text());
    setMapping({});
    setErrorsOpen(false);
    setRecordsText(null);
    setConfirmedKey(null);
    setPickedDateOrder(null);
    setSaveNote(null);
    // Straight to the mapping: it is the next decision, and nothing below it means anything yet.
    setMapOpen(true);
  }

  function reset() {
    setCsv(""); setFile(null); setMapping({}); setErrorsOpen(false); setRecordsText(null);
    setMapOpen(false); setConfirmedKey(null); setPickedDateOrder(null); setSaveNote(null);
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

  function chooseVendor(value: string) {
    setVendorId(value);
    if (campaign && value && campaign.vendor_id !== value) setCampaignId("");
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

  /**
   * The dialog's Continue: confirm the mapping, keep it as the vendor's map when it changed, then
   * run the scrub — or, when the page still needs a campaign or a cost, hand back to the page.
   */
  async function continueFromMapping() {
    setConfirmedKey(currentKey);
    setMapOpen(false);
    const unchanged = saved && mapKey(saved.mapping) === mapKey(effectiveMapping) && (!pickedDateOrder || pickedDateOrder === savedDateOrder);
    if (vendorId && !unchanged) await saveMapping(true);
    if (pageReason || (validation?.validRows ?? 0) === 0 || validation?.error) return;
    await runPreflight();
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
          action: response.status === 409 && batchId ? { label: "Open it", onClick: () => router.push(`/app/import/review/${batchId}`) } : undefined,
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

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader eyebrow={sectionForPath("/app/import") ?? undefined} title="List import" description="Get a vendor CSV into your lead lists — mapped, validated and attributed." />

    <ImportStepper current={step} />

    <form onSubmit={importFile} className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {file
          ? <div className="flex min-w-0 items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-alt)] text-[var(--muted)]"><FileText className="size-5" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{file.name}</strong>
                <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{fileRows.toLocaleString()} rows · {formatBytes(file.size)}</span>
              </span>
              <button type="button" className={btn("row")} onClick={reset}>Replace</button>
            </div>
          : <div
              className={cn("flex min-w-0 flex-col items-center rounded-[12px] border border-dashed bg-[var(--surface)] px-6 py-10 text-center", dragging ? "border-[var(--primary)] bg-[var(--brand-50)]" : "border-[var(--border-strong)]")}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); void takeFile(event.dataTransfer.files?.[0]); }}
            >
              <span className="inline-flex size-[34px] items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)]"><Upload className="size-4" aria-hidden /></span>
              <p className="mt-2.5 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Drop a vendor CSV here</p>
              <p className="mt-1.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">Up to {(info?.maxRows ?? 20000).toLocaleString()} rows per file</p>
              <input id="lead-csv" className="peer sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void takeFile(event.target.files?.[0])} />
              <label htmlFor="lead-csv" className={btn("secondary", "mt-4 h-11 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ring-color)]")}>Choose CSV file</label>
            </div>}

        {/* Where the inline mapping table was: its summary, and the way back into the dialog. */}
        {canMap && <SettingsCard
          pad={20}
          title="Column mapping"
          sub={`${mappingSummary.mapped.toLocaleString()} mapped · ${mappingSummary.needsDecision.toLocaleString()} ${mappingSummary.needsDecision === 1 ? "needs" : "need"} a decision · ${requiredMapped} of ${requiredKeys.length} required fields mapped`}
          action={<span className="flex flex-wrap gap-2">
            {vendorId && <button type="button" className={btn("secondary")} onClick={() => void saveMapping()}>Save mapping</button>}
            <button type="button" className={btn(mapConfirmed ? "secondary" : "primary-sm")} onClick={() => setMapOpen(true)}>Map columns</button>
          </span>}
          bodyClassName="flex flex-col gap-1.5"
        >
          <p className="m-0 flex items-center gap-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
            {mapConfirmed
              ? <><Pill tone="success" dot>Confirmed</Pill>The scrub reads the file with this mapping.</>
              : <><Pill tone="warning" dot>Not confirmed</Pill>Check each column before the scrub.</>}
          </p>
          {dateOrderToSend && (datePicked || dates.ambiguous === 0) && <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Slash dates are read {dateOrderToSend === "dmy" ? "day first" : "month first (US)"}{datePicked ? "" : ", the reading that fits this file's dates"}.</p>}
          {saveNote && <p role="status" className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{saveNote}</p>}
        </SettingsCard>}

        {canMap && file && <ColumnMappingDialog
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          onBack={() => setMapOpen(false)}
          onContinue={() => void continueFromMapping()}
          fileName={file.name}
          rowCount={fileRows}
          columnCount={preview.headers.length}
          rows={mappingRows}
          fields={mappingFields}
          onMap={(header, fieldKey) => setMapping((current) => ({ ...current, [header]: fieldKey }))}
          vendorName={vendorName}
          hasSavedMap={Boolean(saved)}
          savedDateOrder={savedDateOrder}
          dates={dates}
          dateOrder={dateOrder}
          datePicked={datePicked}
          onPickDateOrder={setPickedDateOrder}
          continueNote={pageReason ? `${pageReason} Continue keeps this mapping and takes you back to the page.` : null}
          busy={saving}
        />}

        {csv && <SettingsCard pad={20} title="CSV preview" sub={`The first ${preview.rows.length} row${preview.rows.length === 1 ? "" : "s"} of the file, as it arrived.`}>
          {preview.error
            ? <p role="alert" className="text-[14px] leading-[1.5] text-[var(--error-ink)]">{preview.error}</p>
            : <div className="min-w-0 overflow-x-auto rounded-[8px] border border-[var(--border)]">
                <table className={st.table}>
                  <thead><tr className={st.headRow}>{preview.headers.map((header, index) => <th scope="col" key={`${header}-${index}`} className={st.th}>{header}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>{preview.headers.map((_, cellIndex) => <td key={cellIndex} className={cn(st.td, "whitespace-nowrap")}>{row[cellIndex] ?? ""}</td>)}</tr>)}</tbody>
                </table>
              </div>}
        </SettingsCard>}

        {csv && validation && <SettingsCard pad={20} title="Validation summary">
          {validation.error
            ? <p role="alert" className="text-[14px] leading-[1.5] text-[var(--error-ink)]">{validation.error} Correct the file and choose it again.</p>
            : <div className="flex flex-col gap-3">
                <div role="status" className="grid gap-3 sm:grid-cols-2">
                  <div className="flex gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--success-surface)] px-4 py-3">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--success-ink)]" aria-hidden />
                    <span className="min-w-0">
                      <strong className="block text-[14px] leading-[1.5] font-semibold text-[var(--ink)]">{validation.validRows.toLocaleString()} row{validation.validRows === 1 ? "" : "s"} ready</strong>
                      <span className="block text-[12px] leading-[1.5] text-[var(--body)]">These go on to be screened and de-duplicated on the next step.</span>
                    </span>
                  </div>
                  {validation.rejectedRows > 0 && <div className="flex gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--warning-surface)] px-4 py-3">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--warning-ink)]" aria-hidden />
                    <span className="min-w-0">
                      <strong className="block text-[14px] leading-[1.5] font-semibold text-[var(--ink)]">{validation.rejectedRows.toLocaleString()} row{validation.rejectedRows === 1 ? " needs" : "s need"} attention</strong>
                      <span className="block text-[12px] leading-[1.5] text-[var(--body)]">They are listed as Invalid on the review and left out. The rest of the file can still be imported.</span>
                    </span>
                  </div>}
                </div>
                {validation.rowErrors.length > 0 && <button type="button" className={btn("row", "self-start")} aria-expanded={errorsOpen} onClick={() => setErrorsOpen((open) => !open)}>
                  View errors ({validation.rejectedRows.toLocaleString()})
                  <ChevronDown className={cn("size-4 transition-transform", errorsOpen && "rotate-180")} aria-hidden />
                </button>}
                {errorsOpen && validation.rowErrors.length > 0 && <ul className="m-0 flex list-none flex-col gap-1 rounded-[8px] border border-[var(--border)] bg-[var(--surface-alt)] p-3 text-[14px] leading-[1.5] text-[var(--body)]">
                  {validation.rowErrors.map((item) => <li key={item.rowNumber}>{item.message}</li>)}
                  {validation.moreRowErrors > 0 && <li className="text-[var(--muted)]">and {validation.moreRowErrors.toLocaleString()} more row{validation.moreRowErrors === 1 ? "" : "s"} with problems</li>}
                </ul>}
                {/* Named, not implied. Ray is about to pay for rows this screen cannot judge:
                    the scrub runs on the server against lists that change by the hour. The
                    honest preflight says what it has NOT checked, rather than showing a clean
                    bill of health and refusing 180 rows a minute later. */}
                <p className="flex gap-2 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />Suppression screening runs on the next step. Numbers on a DNC, litigator or invalid list are recorded against this campaign for a vendor credit, so the imported total can be lower than {validation.validRows.toLocaleString()}.</p>
              </div>}
        </SettingsCard>}
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:w-[340px] lg:shrink-0">
        {info && campaigns.length === 0
          ? <DashedCard
              icon={<Store className="size-4" aria-hidden />}
              title="Create a campaign first"
              action={info.canCreateCampaigns ? <Link href="/app/campaigns" className={btn("secondary", "h-11")}>Go to Vendors &amp; campaigns</Link> : undefined}
            >
              {info.canCreateCampaigns
                ? "Every import is attributed to a campaign, which carries its vendor and what the list cost. Use New campaign on Vendors & campaigns, then come back to import."
                : "Every import is attributed to a campaign, which carries its vendor and what the list cost. Ask an owner or producer to create one on Vendors & campaigns."}
            </DashedCard>
          : <SettingsCard pad={20} title="Attribution" sub="Chosen before review. New leads carry this campaign permanently. People you already have get it added as an extra source." bodyClassName="flex flex-col gap-3.5">
              <Field label="Vendor" htmlFor="lead-vendor" hint={vendorId ? "Filters the campaigns below, and reuses its saved column mapping." : undefined}>
                <select id="lead-vendor" className={control} value={vendorId} onChange={(event) => chooseVendor(event.target.value)}>
                  <option value="">Any vendor</option>
                  {activeVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                </select>
              </Field>
              <Field label="Campaign" htmlFor="lead-campaign" required hint={campaign && campaign.status !== "active" ? `This campaign is ${campaign.status}. Its leads are imported but not dialled until it is active.` : undefined}>
                <select id="lead-campaign" className={control} required value={campaignId} onChange={(event) => chooseCampaign(event.target.value)}>
                  <option value="">Choose a campaign</option>
                  {visibleCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}{STATUS_SUFFIX[item.status] ?? ""}</option>)}
                </select>
              </Field>
              <Field label="Batch cost" htmlFor="lead-cost" hint="What this file cost, in dollars and cents. Optional." error={cost === "invalid" ? "Enter an amount like 4,500.00, up to $1,000,000." : undefined}>
                <span className="relative block">
                  <span aria-hidden className="pointer-events-none absolute top-[calc(50%+3px)] left-3 -translate-y-1/2 text-[16px] text-[var(--muted)]">$</span>
                  <input id="lead-cost" className={cn(control, "pl-7 tabular-nums")} inputMode="decimal" autoComplete="off" placeholder="0.00" value={costText} onChange={(event) => setCostText(event.target.value)} aria-invalid={cost === "invalid" || undefined} />
                </span>
              </Field>
              <Field label="Rows purchased" htmlFor="lead-records" hint={fileRows ? `Defaults to the file's ${fileRows.toLocaleString()} rows.` : "Defaults to the file's row count."} error={records === "invalid" ? "Enter a whole number of rows." : undefined}>
                <input id="lead-records" className={cn(control, "tabular-nums")} inputMode="numeric" autoComplete="off" value={recordsValue} onChange={(event) => setRecordsText(event.target.value)} aria-invalid={records === "invalid" || undefined} />
              </Field>
            </SettingsCard>}

        {!storageOk && <Callout tone="warning" title="This browser will not hold the file between pages">
          Review is a separate page, so the file has to survive the navigation. Check that site data is enabled for this site.
        </Callout>}

        <div>
          <button type="submit" className={btn("primary", "h-11 w-full")} disabled={Boolean(blockedReason) || saving} aria-describedby="import-continue-note">
            {saving ? "Checking…" : "Continue to review"}
          </button>
          <p id="import-continue-note" className="mt-2 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            {blockedReason ?? "Nothing is imported yet. The next screen shows what is clean, what is on a do-not-call or litigator list, and who you already have — and lets you decide what to do with each group."}
          </p>
        </div>
      </div>
    </form>

    <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-4">
      <SettingsCard pad={20} title="Plan usage" sub="Imports and scrubs stop before they exceed a hard cap." bodyClassName="flex flex-col gap-4">
        {usage.length === 0 && <p className="text-[14px] text-[var(--muted)]">{info ? "No import limits on this plan." : "Loading…"}</p>}
        {usage.map((item) => {
          const pct = item.limit === null ? 0 : Math.min(100, Math.round((item.usage / Math.max(1, item.limit)) * 100));
          return item.limit === null
            ? <div key={item.key} className="flex justify-between gap-3 text-[12px] leading-[1.5] text-[var(--muted)] tabular-nums"><span>{item.label}</span><span>{item.usage.toLocaleString()} used</span></div>
            : <SettingsMeter key={item.key} value={item.usage} max={item.limit} tone={pct >= 90 ? "error" : pct >= 75 ? "warning" : "primary"} label={item.label} valueLabel={`${item.usage.toLocaleString()} of ${item.limit.toLocaleString()}`} caption={`${pct}%`} ariaLabel={`${item.label}: ${pct}% used`} />;
        })}
      </SettingsCard>

      <SettingsCard pad={20} title="Import rules" bodyClassName="flex flex-col gap-3.5">
        {[
          { icon: CheckCircle2, title: "Identity fields required", body: "Each row needs a valid phone, first name, and last name. State, email, and all other fields are optional." },
          { icon: CheckCircle2, title: "Stage is automatic", body: "If the CSV has no stage column, leads start in the first active pipeline stage." },
          { icon: CalendarCheck, title: "Maximum file size", body: `Up to ${(info?.maxRows ?? 20000).toLocaleString()} rows per file, committed as one transaction — all of it or none of it.` },
          { icon: RefreshCw, title: "Deduplication", body: "We match on phone number. People you already have keep one lead and get this campaign added as an extra source; anyone already worked is not put back in the dialer." },
        ].map((rule) => <div key={rule.title} className="flex gap-2.5">
          <rule.icon className="mt-0.5 size-4 shrink-0 text-[var(--success-ink)]" aria-hidden />
          <span className="min-w-0">
            <strong className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{rule.title}</strong>
            <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{rule.body}</span>
          </span>
        </div>)}
      </SettingsCard>

      <SettingsCard pad={20} title="Available stages" sub="Imported leads can start in any of these.">
        <div className="flex flex-wrap gap-2">{info?.stages.map((stage) => <Pill key={stage.id}>{stage.name}</Pill>)}</div>
      </SettingsCard>

      <SettingsCard pad={20} title="Expected fields" sub={info ? `The ${info.product.name} lead record.` : undefined}>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {info?.fields.map((field) => <li key={field.key} className="flex min-w-0 items-baseline justify-between gap-3">
            <code className={cn(st.code, "truncate")}>{field.key}</code>
            <span className="shrink-0 text-[12px] leading-[1.5] text-[var(--muted)]">{field.type}{field.required ? " · required" : ""}</span>
          </li>)}
        </ul>
      </SettingsCard>
    </div>
  </div>;
}
