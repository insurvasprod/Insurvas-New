"use client";

/**
 * "Import statement": the three steps from a carrier's file to lines waiting for a person.
 *
 *   1 · File, carrier and period. CSV, Excel (.xlsx) or PDF (LA-4.1). An Excel workbook is read in
 *       the browser into the same CSV text the server reads, so the columns and the preview are the
 *       file's own. A PDF skips steps 2 and 3: it is stored, and its lines are typed in on the
 *       statement (LA-4.2). No AI reads it.
 *   2 · Columns. The mapping last used for this carrier is offered first; otherwise it is guessed
 *       from the headers. Policy number and amount are required.
 *   3 · Preview. The server reads the whole file, proposes matches (policy number + carrier, else
 *       insured name + carrier) and refuses a file already imported for this carrier and period. Importing records the
 *       statement and its proposals — nothing posts until someone accepts a match on the review
 *       screen, where this dialog sends them.
 *
 * Mounted in the page header of the ledger and the statements history, as each page's primary
 * action. Only rendered for a viewer who may import; everyone else gets the disabled button and its
 * reason from the page.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isXlsxFile, readXlsxAsCsv } from "@/lib/agentTemplates/xlsx";
import { STATEMENT_FILE_ACCEPT, statementFileKind, statementFileProblem } from "@/lib/ledger/statementFile";
import {
  STATEMENT_FIELDS,
  STATEMENT_FIELD_LABELS,
  STATEMENT_KIND_LABELS,
  REQUIRED_STATEMENT_FIELDS,
  statementDay,
  statementMoney,
  type StatementCarrierOption,
  type StatementMapping,
  type StatementPreview,
} from "@/lib/ledger/statementConstants";
import { readStatementHeaders, sanitizeStatementMapping, statementMappingProblem, suggestStatementMapping } from "@/lib/ledger/statementParse";

type Step = "file" | "map" | "preview";
type FileKind = "csv" | "xlsx" | "pdf";

function lastMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong; nothing was imported.");
  return data;
}

async function postForm<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body: form });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong; nothing was imported.");
  return data;
}

/**
 * Which column holds what — the import's step 2, and re-processing a stored statement (LA-4.3).
 * Policy number and amount are required; every other field is optional.
 */
export function StatementMappingFields({ headers, mapping, onChange, idPrefix = "statement-map" }: {
  headers: string[];
  mapping: StatementMapping;
  onChange: (next: StatementMapping) => void;
  idPrefix?: string;
}) {
  return (
    <>
      {STATEMENT_FIELDS.map((field) => {
        const required = REQUIRED_STATEMENT_FIELDS.includes(field);
        return (
          <div key={field} className="grid gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-start sm:gap-4">
            <div>
              <Label htmlFor={`${idPrefix}-${field}`}>{STATEMENT_FIELD_LABELS[field].label}{required ? "" : " (optional)"}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{STATEMENT_FIELD_LABELS[field].hint}</p>
            </div>
            <select
              id={`${idPrefix}-${field}`}
              className="portal-import-select"
              value={mapping[field] ?? ""}
              onChange={(event) => onChange({ ...mapping, [field]: event.target.value || undefined })}
            >
              <option value="">{required ? "Choose a column…" : "Not in this file"}</option>
              {headers.map((header) => <option key={header} value={header}>{header}</option>)}
            </select>
          </div>
        );
      })}
    </>
  );
}

export function StatementImportButton({
  carriers,
  savedMappings,
  autoOpen = false,
}: {
  carriers: StatementCarrierOption[];
  savedMappings: Record<string, StatementMapping>;
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [carrierId, setCarrierId] = useState("");
  const [period, setPeriod] = useState(lastMonth);
  const [mapping, setMapping] = useState<StatementMapping>({});
  const [mappingSource, setMappingSource] = useState<"saved" | "guessed" | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carrier = carriers.find((option) => option.id === carrierId) ?? null;
  const mappingProblem = useMemo(() => (headers.length ? statementMappingProblem(mapping, headers) : "Choose a file first."), [mapping, headers]);
  const fileProblem = !file || (fileKind !== "pdf" && !csvText) ? "Choose the carrier's statement file: CSV, Excel or PDF." : !carrierId ? "Choose the carrier this statement is from." : !period.start || !period.end ? "Enter the period the statement covers." : period.end < period.start ? "The period ends before it starts." : null;

  function reset() {
    setStep("file"); setFileName(""); setFile(null); setFileKind(null); setSheetName(null); setCsvText(""); setHeaders([]); setCarrierId(""); setPeriod(lastMonth());
    setMapping({}); setMappingSource(null); setPreview(null); setBusy(false); setError(null);
  }

  /** The carrier's remembered mapping when it fits this file; otherwise a guess from the headers. */
  function chooseMapping(nextHeaders: string[], nextCarrierId: string) {
    const saved = nextCarrierId ? sanitizeStatementMapping(savedMappings[nextCarrierId], nextHeaders) : {};
    if (nextCarrierId && savedMappings[nextCarrierId] && REQUIRED_STATEMENT_FIELDS.every((field) => saved[field])) {
      setMapping(saved); setMappingSource("saved");
    } else {
      setMapping(suggestStatementMapping(nextHeaders)); setMappingSource(nextHeaders.length ? "guessed" : null);
    }
  }

  async function chooseFile(next: File | undefined) {
    setError(null); setPreview(null);
    setFile(null); setFileKind(null); setSheetName(null); setCsvText(""); setHeaders([]); setFileName("");
    if (!next) return;
    const problem = statementFileProblem(next);
    if (problem) { setError(problem); return; }
    const kind = statementFileKind(next) as FileKind;
    if (kind === "pdf") {
      setFile(next); setFileKind("pdf"); setFileName(next.name);
      return;
    }
    let text = "";
    try {
      if (kind === "xlsx" || isXlsxFile(next)) {
        const read = await readXlsxAsCsv(await next.arrayBuffer());
        text = read.csv; setSheetName(read.sheetName);
      } else {
        text = (await next.text()).replace(/^\uFEFF/, "");
      }
    } catch (reason) {
      setError(reason instanceof Error ? `The file could not be read: ${reason.message}` : "The file could not be read."); return;
    }
    let nextHeaders: string[] = [];
    try { nextHeaders = readStatementHeaders(text); } catch (reason) { setError(reason instanceof Error ? reason.message : "The file could not be read."); return; }
    if (!nextHeaders.length) { setError("The file has no header row."); return; }
    setFile(next); setFileKind(kind); setFileName(next.name); setCsvText(text); setHeaders(nextHeaders);
    chooseMapping(nextHeaders, carrierId);
  }

  function chooseCarrier(id: string) {
    setCarrierId(id); setPreview(null);
    if (headers.length) chooseMapping(headers, id);
  }

  const body = () => ({ carrier_id: carrierId, period_start: period.start, period_end: period.end, file_name: fileName, csv_text: csvText, mapping });

  async function runPreview() {
    setBusy(true); setError(null);
    try {
      const data = await postJson<{ preview: StatementPreview }>("/api/app/statements/preview", body());
      setPreview(data.preview); setStep("preview");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file || !fileKind) return;
    setBusy(true); setError(null);
    try {
      // The file itself travels (LA-4.1): the server keeps the original and reads it the same way.
      const form = new FormData();
      form.set("file", file);
      form.set("carrier_id", carrierId);
      form.set("period_start", period.start);
      form.set("period_end", period.end);
      form.set("mapping", JSON.stringify(fileKind === "pdf" ? {} : mapping));
      const data = await postForm<{ statementId: string }>("/api/app/statements", form);
      setOpen(false); reset();
      router.push(`/app/statements/${data.statementId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement was not imported.");
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Import statement
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">Import a carrier statement</DialogTitle>
            <DialogDescription>
              {step === "file" && (fileKind === "pdf" ? "A PDF statement is stored as it is, and you type its lines in on the next screen." : "Step 1 of 3 · The file, the carrier and the period it covers.")}
              {step === "map" && "Step 2 of 3 · Which column holds what. Remembered for this carrier after the import."}
              {step === "preview" && "Step 3 of 3 · What will be recorded. Nothing posts to the ledger until a person accepts a match."}
            </DialogDescription>
          </DialogHeader>

          {step === "file" && (
            <div className="grid gap-4 text-sm">
              <div className="grid gap-1.5">
                <Label htmlFor="statement-file">Statement file (CSV, Excel or PDF)</Label>
                <Input id="statement-file" type="file" accept={STATEMENT_FILE_ACCEPT} onChange={(event) => void chooseFile(event.target.files?.[0])} />
                {fileName && fileKind === "pdf" && <p className="text-xs text-muted-foreground">{fileName} · PDF, kept as it is; its lines are typed in after import</p>}
                {fileName && fileKind !== "pdf" && <p className="text-xs text-muted-foreground">{fileName}{sheetName ? ` · sheet “${sheetName}”` : ""} · {headers.length} columns</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="statement-carrier">Carrier</Label>
                <select id="statement-carrier" className="portal-import-select" value={carrierId} onChange={(event) => chooseCarrier(event.target.value)}>
                  <option value="">Choose the carrier…</option>
                  {carriers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Lines are matched to policies recorded with this carrier.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="statement-start">Period from</Label>
                  <Input id="statement-start" type="date" value={period.start} onChange={(event) => setPeriod((current) => ({ ...current, start: event.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="statement-end">Period to</Label>
                  <Input id="statement-end" type="date" value={period.end} onChange={(event) => setPeriod((current) => ({ ...current, end: event.target.value }))} />
                </div>
              </div>
            </div>
          )}

          {step === "map" && (
            <div className="grid gap-3 text-sm">
              {mappingSource === "saved" && carrier && <p className="rounded-md bg-[var(--info-surface)] px-3 py-2 text-[var(--info-ink)]">Using the columns from your last {carrier.name} statement. Change any that moved.</p>}
              {mappingSource === "guessed" && <p className="rounded-md bg-[var(--surface-alt)] px-3 py-2 text-[var(--body)]">Guessed from the column names. Check each one before previewing.</p>}
              <StatementMappingFields headers={headers} mapping={mapping} onChange={setMapping} />
              {mappingProblem && <p className="text-xs font-medium text-[var(--warning-ink)]">{mappingProblem}</p>}
            </div>
          )}

          {step === "preview" && preview && (
            <div className="grid gap-4 text-sm">
              {preview.duplicate && (
                <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3">
                  <p className="font-semibold text-[var(--error-ink)]">This statement is already imported</p>
                  <p className="mt-1 text-[var(--body)]">
                    The same file for {carrier?.name ?? "this carrier"} and this period was imported on {statementDay(preview.duplicate.uploadedAt)}{preview.duplicate.uploadedByName ? ` by ${preview.duplicate.uploadedByName}` : ""}. It will not be imported twice. If that import was wrong, void it on the statement first.
                  </p>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["Lines", preview.totalLines.toLocaleString("en-US")],
                  ["Proposed matches", preview.proposedLines.toLocaleString("en-US")],
                  ["No match yet", preview.unmatchedLines.toLocaleString("en-US")],
                  ["Could not read", preview.errorLines.toLocaleString("en-US")],
                  ["Net on statement", statementMoney(preview.netCents)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border bg-[var(--surface-alt)] px-3 py-2">
                    <dt className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr>
                      <th className="w-[56px] text-right">Row</th>
                      <th>On the statement</th>
                      <th className="w-[110px]">Kind</th>
                      <th className="w-[110px]">Date</th>
                      <th className="w-[120px] text-right">Amount</th>
                      <th>Proposed match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((line) => (
                      <tr key={line.lineNumber}>
                        <td className="text-right tabular-nums text-muted-foreground">{line.lineNumber}</td>
                        <td>
                          <span className="block font-semibold text-foreground">{line.policyNumber ?? "No policy number"}</span>
                          {line.insuredName && <span className="block text-xs text-muted-foreground">{line.insuredName}</span>}
                        </td>
                        <td>{line.kind ? STATEMENT_KIND_LABELS[line.kind] : "—"}{line.kindFrom === "sign" && <span className="block text-xs text-muted-foreground">from the sign</span>}</td>
                        <td className="tabular-nums">{line.lineDate ? statementDay(line.lineDate) : "—"}</td>
                        <td className="text-right font-semibold tabular-nums">{line.amountCents === null ? "—" : statementMoney(line.amountCents)}</td>
                        <td>
                          {line.error ? (
                            <span className="text-[var(--error-ink)]">{line.error}</span>
                          ) : line.proposal ? (
                            <>
                              <span className="block font-semibold text-foreground">{line.proposal.policyNumber}</span>
                              <span className="block text-xs text-muted-foreground">{line.proposal.insuredName} · {line.proposalMethod === "name" ? "by insured name, check it" : "waits for acceptance"}</span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">{line.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.sample.length < preview.totalLines && (
                <p className="text-xs text-muted-foreground">
                  Showing {preview.sample.length} of {preview.totalLines.toLocaleString("en-US")} lines, unreadable ones first.
                </p>
              )}
            </div>
          )}

          {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}

          <DialogFooter>
            {step !== "file" && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(null); setStep(step === "preview" ? "map" : "file"); }}>
                Back
              </Button>
            )}
            {step === "file" && fileKind !== "pdf" && (
              <Button type="button" disabled={Boolean(fileProblem)} title={fileProblem ?? undefined} onClick={() => { setError(null); setStep("map"); }}>
                Next: columns
              </Button>
            )}
            {step === "file" && fileKind === "pdf" && (
              <Button type="button" disabled={Boolean(fileProblem) || busy} title={fileProblem ?? undefined} onClick={() => void runImport()}>
                {busy ? "Storing…" : "Store PDF and enter its lines"}
              </Button>
            )}
            {step === "map" && (
              <Button type="button" disabled={Boolean(mappingProblem) || busy} title={mappingProblem ?? undefined} onClick={() => void runPreview()}>
                {busy ? "Reading the file…" : "Preview"}
              </Button>
            )}
            {step === "preview" && preview && (
              <Button type="button" disabled={busy || Boolean(preview.duplicate)} title={preview.duplicate ? "Already imported for this carrier and period" : undefined} onClick={() => void runImport()}>
                {busy ? "Importing…" : `Import ${preview.totalLines.toLocaleString("en-US")} lines for review`}
              </Button>
            )}
          </DialogFooter>
          {step === "file" && fileProblem && <p className="-mt-2 text-right text-xs text-muted-foreground">{fileProblem}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
