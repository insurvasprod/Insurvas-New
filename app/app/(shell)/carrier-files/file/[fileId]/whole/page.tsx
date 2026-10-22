import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { columnLetter } from "@/lib/ingestion/grid";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileHref } from "@/lib/ingestion/trace";
import { headerLine, loadWholeFile, shownSheet } from "@/lib/ingestion/wholeFile";
import { CarrierFileDownload } from "@/components/app/carrier-file-download";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Carrier files › one file › the whole file (Owner request 2026-10-14): every single thing in the
 * carrier's file, exactly as the file has it, inside the software — no download. A spreadsheet shows
 * every sheet (hidden ones too) and every line of the chosen sheet, title lines above the header
 * included, one column per spreadsheet column (A, B, C…). A PDF shows the original itself and every
 * line of its text. Ten lines a page. Owner and bookkeeper. Opening it writes nothing.
 */
const LINES_PER_PAGE = 10;

export default async function WholeCarrierFilePage({ params, searchParams }: { params: Promise<{ fileId: string }>; searchParams: Promise<{ page?: string; sheet?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files, and the rows in them, are opened by the account owner or a bookkeeper." />;
  const { fileId } = await params;
  if (!isRecordUuid(fileId)) notFound();
  const { page, sheet: asked } = await searchParams;
  const file = await loadWholeFile(guard.context.tenantId, fileId);
  if (!file) notFound();

  const header = (
    <PageHeader
      title={file.name}
      description="The whole file, exactly as the carrier sent it."
      actions={<>
        <Button asChild variant="outline"><Link href={fileHref(file.id)}>Back to the file</Link></Button>
        <CarrierFileDownload fileId={file.id} />
      </>}
    />
  );

  if (file.problem) {
    return (
      <div className="m-stagger flex flex-col gap-6">
        {header}
        <TableCard><EmptyState title="The file can't be shown" hint={file.problem} /></TableCard>
      </div>
    );
  }

  // ─── a PDF: the original, then every line of its text ─────────────────────────────────────────
  if (file.pdfLines) {
    const lines = file.pdfLines;
    const pages = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
    const at = Math.min(Math.max(1, Number(page) || 1), pages);
    // Line numbers count from the top of each page of the PDF.
    const numbered = lines.reduce<Array<(typeof lines)[number] & { number: number }>>((out, line, index) => {
      const previous = out[index - 1];
      out.push({ ...line, number: previous && lines[index - 1].page === line.page ? previous.number + 1 : 1 });
      return out;
    }, []);
    const shown = numbered.slice((at - 1) * LINES_PER_PAGE, at * LINES_PER_PAGE);
    return (
      <div className="m-stagger flex flex-col gap-6">
        {header}
        <TableCard title="The PDF">
          <iframe src={`/api/app/carrier-files/${file.id}/view`} title={`${file.name}, the carrier's PDF`} className="block h-[80vh] w-full border-0" />
        </TableCard>
        <TableCard
          title="Every line of text"
          description={lines.length ? "Each line of the PDF's text, top to bottom, page by page." : undefined}
          footer={lines.length ? <Pager page={at} pageSize={LINES_PER_PAGE} total={lines.length} noun="lines" pageHref="?" /> : undefined}
        >
          {lines.length === 0 ? <EmptyState title="No text in this PDF" hint="It looks scanned (an image of a page), so it has no lines to list. The PDF above shows it." /> : (
            <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr>
                  <th className="w-[72px] text-right">Page</th>
                  <th className="w-[72px] text-right">Line</th>
                  <th>Text</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => (
                  <tr key={`${line.page}-${line.number}`}>
                    <td className="text-right tabular-nums">{line.page}</td>
                    <td className="text-right tabular-nums">{line.number}</td>
                    <td className="whitespace-pre font-mono text-xs">{line.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </div>
    );
  }

  // ─── a spreadsheet: every sheet, every line ─────────────────────────────────────────────────────
  const sheets = file.sheets ?? [];
  const sheet = shownSheet(sheets, asked, file.sheetRead);
  const grid = sheet?.grid ?? [];
  const width = Math.max(0, ...grid.map((row) => row.length));
  const pages = Math.max(1, Math.ceil(grid.length / LINES_PER_PAGE));
  const at = Math.min(Math.max(1, Number(page) || 1), pages);
  const from = (at - 1) * LINES_PER_PAGE;
  const shown = grid.slice(from, from + LINES_PER_PAGE);
  const mark = sheet ? headerLine(sheet, sheets, file.sheetRead, file.headerRow) : null;
  const workbook = file.kind !== "csv";
  const sheetHref = (name: string) => `?sheet=${encodeURIComponent(name)}`;
  const readNote = workbook ? (file.sheetRead ? `The rows were read from the sheet "${file.sheetRead}".` : "No sheet has been read yet.") : null;

  return (
    <div className="m-stagger flex flex-col gap-6">
      {header}
      {workbook && sheets.length > 0 && (
        <ViewTabs
          label="Sheets"
          value={sheet?.name ?? ""}
          tabs={sheets.map((one) => ({ key: one.name, label: `${one.name}${one.hidden ? " (hidden)" : ""}${one.name === file.sheetRead ? " · read" : ""}`, href: sheetHref(one.name) }))}
        />
      )}
      <TableCard
        title={workbook ? (sheet ? `Sheet "${sheet.name}"${sheet.hidden ? " (hidden)" : ""}` : "Sheets") : "Every line"}
        description={[`${grid.length.toLocaleString("en-US")} ${grid.length === 1 ? "line" : "lines"} and ${width} ${width === 1 ? "column" : "columns"}, scroll sideways for more.`, readNote].filter(Boolean).join(" ")}
        footer={grid.length ? <Pager page={at} pageSize={LINES_PER_PAGE} total={grid.length} noun="lines" pageHref={workbook && sheet ? sheetHref(sheet.name) : "?"} /> : undefined}
      >
        {grid.length === 0 ? <EmptyState title="This sheet is empty" hint={workbook && sheets.length > 1 ? "Choose another sheet above." : "The file has no lines."} /> : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] w-[136px] bg-[var(--surface-alt)] text-right">Line</th>
                {Array.from({ length: width }, (_, index) => <th key={index} className="min-w-[96px] max-w-[220px]">{columnLetter(index)}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((cells, offset) => {
                const line = from + offset + 1;
                const isHeader = mark?.line === line;
                return (
                  <tr key={line} className="group">
                    <td className="sticky left-0 z-[1] bg-[var(--surface)] text-right tabular-nums group-hover:bg-[var(--surface-alt)]">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {isHeader && <StatusChip tone={mark.read ? "info" : "neutral"} dot={false}>{mark.read ? "Header" : "Likely header"}</StatusChip>}
                        {line}
                      </span>
                    </td>
                    {Array.from({ length: width }, (_, index) => {
                      const value = cells[index] ?? "";
                      return <td key={index} className={`max-w-[220px] truncate font-mono text-xs ${isHeader ? "font-semibold text-foreground" : ""}`} title={value}>{value}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
