"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CarrierImport } from "@/lib/ingestion/bookImport";
import { fileDay } from "@/lib/ingestion/constants";
import { fileHref } from "@/lib/ingestion/trace";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const BOOK_FILE = /\.(csv|xlsx|xls)$/i;

export type ResultTone = "muted" | "ok" | "warn" | "busy";

/** "Americo — 112 policies, $8,420/mo. 3 at risk." — the moment each upload is worth it. */
export function resultLine(c: CarrierImport): { text: string; tone: ResultTone } {
  if (c.status === "skipped" && !c.file) return { text: "Skipped for now — import it any time.", tone: "muted" };
  if (!c.file) return { text: "Not imported yet", tone: "muted" };
  if (c.file.status === "received" || c.file.status === "parsing") return { text: "Reading the file…", tone: "busy" };
  if (c.file.status === "failed") return { text: c.file.error ?? "The file could not be read.", tone: "warn" };
  if (c.file.block) return { text: c.file.block, tone: "warn" };
  const r = c.result;
  const held = c.file.held ? ` ${c.file.held.toLocaleString("en-US")} rows wait for a status word to be mapped.` : "";
  if (!r) return { text: `Read — no policies yet.${held}`, tone: held ? "warn" : "muted" };
  return { text: `${r.policies.toLocaleString("en-US")} ${r.policies === 1 ? "policy" : "policies"}, ${money(r.monthlyPremiumCents)}/mo. ${r.atRisk.toLocaleString("en-US")} at risk.${held}`, tone: held ? "warn" : "ok" };
}

export const RESULT_TONE: Record<ResultTone, string> = { muted: "text-muted-foreground", ok: "font-semibold text-foreground", warn: "text-[var(--warning-ink)]", busy: "text-muted-foreground italic" };

/** A key and its value, as the dialog's facts list. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-sm text-[var(--body)]">{children}</dd>
    </>
  );
}

/**
 * Carrier sync › Files in › Your carriers (r7 4·3): a carrier's book import, opened from its row (or by dropping a
 * file on the row). What sat in every row before — the date, Upload / Replace, Skip for now / Undo skip — is here,
 * beside the portal guidance for fetching the file. Not in yet: "Bring in X's book"; in: its last file and result,
 * and a drop to replace it. The same /api/app/book-import calls as before; read-only shows the facts and Close.
 */
export function FilesInImportDialog({ carrier, initialFile, readOnly, onClose }: {
  carrier: CarrierImport;
  /** A file dropped on the carrier's row: the dialog opens with it chosen. */
  initialFile: File | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [file, setFile] = useState<File | null>(initialFile && BOOK_FILE.test(initialFile.name) ? initialFile : null);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(initialFile && !BOOK_FILE.test(initialFile.name) ? "Choose a CSV or an Excel file." : null);
  const name = carrier.carrierName;
  const g = carrier.guidance;
  const inAlready = Boolean(carrier.file);
  const line = resultLine(carrier);

  function choose(next: File | undefined) {
    setProblem(null);
    if (!next) return;
    if (!BOOK_FILE.test(next.name)) { setFile(null); setProblem("Choose a CSV or an Excel file."); return; }
    setFile(next);
  }

  async function upload() {
    if (!file) return setProblem("Choose the file to upload.");
    if (!date) return setProblem("Enter the date on the file.");
    setBusy(true);
    setProblem(null);
    const chosen = file;
    const send = async () => {
      const form = new FormData();
      form.set("file", chosen);
      form.set("carrier_id", carrier.carrierId);
      form.set("file_date", date);
      const response = await fetch("/api/app/book-import", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { error?: string; outcome?: string };
      if (!response.ok) throw new Error(data.error ?? "That file did not upload.");
      return data;
    };
    try {
      // One toast from the upload to its outcome (2026-10-28); a refusal stays in the dialog, beside what to fix.
      await notify.promise(send, {
        loading: `Uploading ${chosen.name}…`,
        done: (data) => (data.outcome === "skipped" ? "That exact file was already here — using it." : "Uploaded. Reading it now…"),
        fail: null,
      });
      onClose();
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That file did not upload.");
    } finally {
      setBusy(false);
    }
  }

  async function skip(action: "skip" | "unskip") {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/app/book-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, carrier_id: carrier.carrierId }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(action === "skip" ? `${name} skipped for now — import it any time.` : `${name} is back on the list.`);
      onClose();
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  const inputId = `book-file-${carrier.carrierId}`;
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size={"lg"}>
        <DialogHeader>
          <DialogTitle>{inAlready ? `${name}'s book` : `Bring in ${name}'s book`}</DialogTitle>
          {inAlready
            ? <DialogDescription className="sr-only">{name}&apos;s last in-force file and what it brought in.</DialogDescription>
            : <DialogDescription>Its latest in-force file: that is your existing book with {name}.</DialogDescription>}
        </DialogHeader>

        <div className="grid gap-4">
          <dl className="m-0 grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 gap-y-2">
            {inAlready && carrier.file ? (
              <>
                <Fact label="Last file"><Link href={fileHref(carrier.file.id)} className="text-[var(--accent-ink)] hover:underline">{carrier.file.name}</Link>{carrier.file.fileDate ? ` · ${fileDay(carrier.file.fileDate)}` : ""}</Fact>
                <Fact label="Result"><span role="status" className={RESULT_TONE[line.tone]}>{line.text}</span></Fact>
              </>
            ) : g ? (
              <>
                <Fact label="Where to find it">{g.whereInPortal}</Fact>
                {g.reportName && <Fact label="Usually called">{g.reportName}</Fact>}
                {g.formatHint && <Fact label="Choose">{g.formatHint}</Fact>}
                {g.notes && <Fact label="Note">{g.notes}</Fact>}
              </>
            ) : (
              <Fact label="Where to find it">The in-force report in its agent portal</Fact>
            )}
            {!inAlready && carrier.status === "skipped" && <Fact label="Now">Skipped for now — import it any time.</Fact>}
          </dl>
          {inAlready && carrier.file?.held ? (
            <Link href={fileHref(carrier.file.id)} className="text-xs text-[var(--accent-ink)] hover:underline">See the {carrier.file.held.toLocaleString("en-US")} rows waiting on a status word ›</Link>
          ) : null}

          {readOnly ? (
            <p className="m-0 text-sm text-muted-foreground">Receiving files is paused while the account is read-only.</p>
          ) : (
            <>
              <label
                htmlFor={inputId}
                className={cn(
                  "grid cursor-pointer gap-1 rounded-lg border border-dashed border-border bg-[var(--surface-alt)] px-4 py-6 text-center text-sm text-[var(--body)] transition-colors hover:border-[var(--primary)]",
                  over && "border-[var(--primary)]",
                )}
                onDragOver={(event) => { event.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(event) => { event.preventDefault(); setOver(false); choose(event.dataTransfer.files?.[0]); }}
              >
                {file ? (
                  <><span className="font-semibold text-foreground">{file.name}</span><span className="text-xs text-muted-foreground">Drop another file, or <span className="text-[var(--accent-ink)] underline-offset-4 hover:underline">choose it</span>, to change it</span></>
                ) : inAlready ? (
                  <span>Drop a newer file to <b className="text-foreground">replace</b> it, or <span className="text-[var(--accent-ink)]">choose it</span></span>
                ) : (
                  <><span><b className="text-foreground">Drop the file here</b> or <span className="text-[var(--accent-ink)]">choose it</span></span><span className="text-xs text-muted-foreground">CSV or Excel</span></>
                )}
                <input id={inputId} type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={(event) => { const next = event.target.files?.[0]; event.target.value = ""; choose(next); }} />
              </label>
              <div className="grid gap-1.5">
                <Label htmlFor={`${inputId}-date`}>Date on the file</Label>
                <Input id={`${inputId}-date`} type="date" className="h-9 w-[200px]" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
              </div>
            </>
          )}
          {problem && <p role="alert" className="m-0 text-sm font-medium text-[var(--error-ink)]">{problem}</p>}
        </div>

        <DialogFooter>
          {readOnly || (inAlready && !file) ? (
            <Button type="button" onClick={onClose}>Close</Button>
          ) : (
            <>
              {!inAlready && (carrier.status === "skipped"
                ? <Button type="button" variant="ghost" className="sm:mr-auto" disabled={busy} onClick={() => void skip("unskip")}>Undo skip</Button>
                : <Button type="button" variant="ghost" className="sm:mr-auto" disabled={busy} onClick={() => void skip("skip")}>Skip for now</Button>)}
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={busy || !file} onClick={() => void upload()}>{busy ? "Uploading…" : inAlready ? "Replace" : "Upload"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
