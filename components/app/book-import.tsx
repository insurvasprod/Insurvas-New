"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { FilesInImportDialog, resultLine } from "@/components/app/book/setup/files-in-import-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { CarrierImport } from "@/lib/ingestion/bookImport";
import { fileDay } from "@/lib/ingestion/constants";
import { cn } from "@/lib/utils";

type Show = "all" | "not-imported" | "needs-look";
const notImported = (c: CarrierImport) => !c.file && c.status !== "skipped";
const needsLook = (c: CarrierImport) => resultLine(c).tone === "warn";

/**
 * A row's result as one plain value or one chip (owner 2026-11-11, one-line rows): what came in, plainly; anything
 * else as a chip whose tone carries it. The whole sentence is on hover, and in the carrier's dialog.
 */
function resultCell(c: CarrierImport) {
  const line = resultLine(c);
  if (line.tone === "ok" && c.result) return <span className="whitespace-nowrap tabular-nums" title={line.text}>{`${c.result.policies.toLocaleString("en-US")} ${c.result.policies === 1 ? "policy" : "policies"}`}</span>;
  if (line.tone === "warn") return <StatusChip tone="warning" title={line.text}>Needs a look</StatusChip>;
  if (line.tone === "busy") return <StatusChip tone="neutral" title={line.text}>Reading…</StatusChip>;
  if (c.status === "skipped" && !c.file) return <StatusChip tone="neutral" title={line.text}>Skipped</StatusChip>;
  if (!c.file) return <StatusChip tone="neutral">Not imported</StatusChip>;
  return <span className="whitespace-nowrap" title={line.text}>No policies yet</span>;
}

/**
 * LA-4.10 (Notion sprint) · import the book one carrier at a time. r7 4·A (owner 2026-11-10): Files in's first tab,
 * Your carriers. A row is the carrier: clicking it — or dropping its file on it — opens its import dialog
 * (files-in-import-dialog.tsx), where the date, Upload / Replace and Skip for now / Undo skip now sit; no inputs in
 * rows. Each upload is read straight away and its result shown on its row. The carriers are the agency's own from
 * Settings › Carriers (LA-0.4): another one is added there, not here.
 */
export function BookImport({ carriers, processing, readOnly }: { carriers: CarrierImport[]; processing: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<{ carrierId: string; file: File | null } | null>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");

  // While a file is being read, look again every few seconds, so its result appears on its own.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [processing, router]);

  const counts = { all: carriers.length, "not-imported": carriers.filter(notImported).length, "needs-look": carriers.filter(needsLook).length };
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return carriers.filter((c) => (!needle || c.carrierName.toLowerCase().includes(needle)) && (show === "all" || (show === "not-imported" ? notImported(c) : needsLook(c))));
  }, [carriers, query, show]);
  const chosen = open ? carriers.find((c) => c.carrierId === open.carrierId) ?? null : null;
  const clear = () => { setQuery(""); setShow("all"); };

  const dropProps = (c: CarrierImport) => ({
    onDragOver: (e: React.DragEvent) => { if (!readOnly) { e.preventDefault(); setOver(c.carrierId); } },
    onDragLeave: () => setOver((cur) => (cur === c.carrierId ? null : cur)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); const file = e.dataTransfer.files?.[0]; if (file && !readOnly) setOpen({ carrierId: c.carrierId, file }); },
  });
  const nextStep = (c: CarrierImport) => (!readOnly && !c.file ? (c.status === "skipped" ? "Import it" : "Bring it in") : null);

  return (
    <>
      <PagedTableCard
        total={rows.length}
        noun="carriers"
        suffix={readOnly ? undefined : "drop a carrier's file on its row to bring it in"}
        toolbar={
          <DataToolbar actions={<>
            <Link href="/app/settings#carriers" className="text-sm hover:underline">Add a carrier in Settings ›</Link>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} labelClassName="sr-only" />
          </>}>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Search carriers" />
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-1.5">
              <ToggleChip role="radio" selected={show === "all"} count={counts.all} onClick={() => setShow("all")}>All</ToggleChip>
              <ToggleChip role="radio" selected={show === "not-imported"} count={counts["not-imported"]} countTone={counts["not-imported"] ? "warning" : undefined} onClick={() => setShow("not-imported")}>Not imported</ToggleChip>
              <ToggleChip role="radio" selected={show === "needs-look"} count={counts["needs-look"]} countTone={counts["needs-look"] ? "danger" : undefined} onClick={() => setShow("needs-look")}>Needs a look</ToggleChip>
            </div>
          </DataToolbar>
        }
        footer={carriers.length ? (
          <div className="flex w-full flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {!readOnly && <span>Drop a carrier&apos;s file on its row to bring it in.</span>}
            <span className="ml-auto tabular-nums">{rows.length.toLocaleString("en-US")} {rows.length === 1 ? "carrier" : "carriers"}</span>
          </div>
        ) : undefined}
      >
        {carriers.length === 0 ? (
          <EmptyState title="No carriers yet" hint="Add the carriers you write in Settings › Carriers, then bring in each one's latest policy file." />
        ) : rows.length === 0 ? (
          <NoMatches noun="carriers" onClear={clear} />
        ) : (
          <>
            <table data-guide="book-carriers" className="portal-lead-table hidden w-full min-w-[880px] text-left text-sm md:table">
              <thead><tr><th className="w-[200px]">Carrier</th><th>Where to find the file</th><th className="w-[160px]">Result</th><th className="w-[140px]">Last file</th><th className="w-[130px]">Next step</th></tr></thead>
              <PagedBody>
                {rows.map((c) => {
                  const g = c.guidance;
                  const step = nextStep(c);
                  return (
                    <tr
                      key={c.carrierId}
                      className={cn("cursor-pointer", over === c.carrierId && "outline outline-2 outline-[var(--primary)]")}
                      onClick={() => setOpen({ carrierId: c.carrierId, file: null })}
                      {...dropProps(c)}
                    >
                      <td className="whitespace-nowrap font-medium text-foreground" title={c.writes ? "You write this carrier" : undefined}>
                        <button type="button" className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setOpen({ carrierId: c.carrierId, file: null }); }}>{c.carrierName}</button>
                      </td>
                      <td className="whitespace-nowrap" title={g && (g.reportName || g.formatHint) ? [g.reportName && `Usually called: ${g.reportName}`, g.formatHint && `Choose: ${g.formatHint}`].filter(Boolean).join(" · ") : undefined}>
                        {g ? g.whereInPortal : "The in-force report in its agent portal"}
                      </td>
                      <td role="status">{resultCell(c)}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{c.file?.fileDate ? fileDay(c.file.fileDate) : "—"}</td>
                      <td className="whitespace-nowrap">{step ?? "Open"} ›</td>
                    </tr>
                  );
                })}
              </PagedBody>
            </table>
            {/* Phone (r7 4·5): a carrier is a card. After the table, so the page size is measured from the table's rows. */}
            <PagedBody as="ul" label="Carriers" className="m-0 grid list-none gap-2 p-3 md:hidden">
              {rows.map((c) => {
                const step = nextStep(c);
                return (
                  <li key={c.carrierId} className="grid gap-1.5 rounded-lg border border-border bg-card p-3" {...dropProps(c)}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="text-left text-sm font-medium text-foreground" onClick={() => setOpen({ carrierId: c.carrierId, file: null })}>{c.carrierName}</button>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.file?.fileDate ? fileDay(c.file.fileDate) : ""}</span>
                    </div>
                    {c.guidance && !c.file && <span className="text-xs text-muted-foreground">{c.guidance.whereInPortal}{c.guidance.formatHint ? ` · ${c.guidance.formatHint}` : ""}</span>}
                    <span className="justify-self-start">{resultCell(c)}</span>
                    {step && <button type="button" className="justify-self-start text-sm hover:underline" onClick={() => setOpen({ carrierId: c.carrierId, file: null })}>{step} ›</button>}
                  </li>
                );
              })}
            </PagedBody>
          </>
        )}
      </PagedTableCard>
      {chosen && open && (
        <FilesInImportDialog key={`${chosen.carrierId}:${open.file?.name ?? ""}`} carrier={chosen} initialFile={open.file} readOnly={readOnly} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
