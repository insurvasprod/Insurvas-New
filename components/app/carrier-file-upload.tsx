"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CARRIER_FILE_ACCEPT, FILE_TYPE_LABELS, MAX_UPLOAD_BYTES, carrierFileKind, fileDay, type CarrierFileType } from "@/lib/ingestion/constants";
import { prefillFromFilename, type CarrierChoice } from "@/lib/ingestion/path";
import { fileHref } from "@/lib/ingestion/trace";
import { notify } from "@/lib/notify";

const selectClass = `${toolbarControl} w-full`;

type Outcome =
  | { outcome: "registered"; fileId: string; status: "received" | "failed"; errorDetail: string | null; supersededFileId: string | null }
  | { outcome: "skipped" | "restored"; fileId: string };

/** The day's current file an upload would replace. */
type Clash = { id: string; name: string; receivedAt: string };

class ClashError extends Error {
  constructor(readonly existing: Clash) {
    super("A file for this carrier, type and day is already in use.");
  }
}

/** A file's carrier, type, day and agency, filled in for a corrected file or a missing one. */
export type UploadPreset = { carrierId?: string | null; fileType?: CarrierFileType | null; fileDate?: string | null; agency?: string | null };

/**
 * LA-4.1 (Notion sprint) · the upload door. The agent drops a carrier's file and says which carrier,
 * which kind of file and which day it is — filled in from the file name when the name says so. The
 * file is never opened to decide those; it is stored as it came and registered.
 *
 * Round 2 (owner 2026-11-02): the one Upload pop-up everywhere. `preset` fills the fields (Replace with a
 * corrected file: the same carrier, type and day, so the new file supersedes the old one; Missing › Upload
 * it: the carrier). When the file is in, "Open the file" opens its page.
 */
export function CarrierFileUploadButton({ carriers, autoOpen = false, label = "Upload a file", variant, size, preset, title, openWhenDone = false, open: shown, onOpenChange }: {
  carriers: CarrierChoice[];
  autoOpen?: boolean;
  label?: string;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  preset?: UploadPreset;
  title?: string;
  /** End on "Open the file" (the Files area) instead of "Done". */
  openWhenDone?: boolean;
  /**
   * Opened from somewhere else (round 3: a "More" menu item): the caller holds the open state and the
   * button itself is not drawn.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(autoOpen);
  const controlled = shown !== undefined;
  const open = controlled ? shown : ownOpen;
  const setOpen = (next: boolean) => { if (controlled) onOpenChange?.(next); else setOwnOpen(next); };
  const [file, setFile] = useState<File | null>(null);
  const [carrierId, setCarrierId] = useState(preset?.carrierId ?? "");
  const [fileType, setFileType] = useState<CarrierFileType | "">(preset?.fileType ?? "");
  const [fileDate, setFileDate] = useState(preset?.fileDate ?? "");
  const [agency, setAgency] = useState(preset?.agency ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);
  // QA 2026-11-03: the day's file this upload would replace, asked about before anything is stored.
  const [clash, setClash] = useState<Clash | null>(null);

  function reset() {
    setFile(null); setCarrierId(preset?.carrierId ?? ""); setFileType(preset?.fileType ?? ""); setFileDate(preset?.fileDate ?? ""); setAgency(preset?.agency ?? ""); setProblem(null); setDone(null); setClash(null);
  }

  function choose(next: File | undefined) {
    setProblem(null);
    setDone(null);
    if (!next) { setFile(null); return; }
    if (!carrierFileKind(next)) { setFile(null); setProblem("Choose a CSV, an Excel file (.xlsx, or a .xls saved as XML) or a PDF."); return; }
    if (next.size > MAX_UPLOAD_BYTES) { setFile(null); setProblem(`That file is larger than ${MAX_UPLOAD_BYTES / 1_000_000} MB. Have it dropped into the agency's bucket instead, or split it.`); return; }
    setFile(next);
    const filled = prefillFromFilename(next.name, carriers);
    // A preset (a corrected file, a missing one) wins over what the name suggests.
    if (filled.carrierId && !preset?.carrierId) setCarrierId(filled.carrierId);
    if (filled.fileType && !preset?.fileType) setFileType(filled.fileType);
    if (filled.fileDate && !preset?.fileDate) setFileDate(filled.fileDate);
  }

  async function submit(mode: "ask" | "replace" | "separate" = "ask") {
    const replace = mode === "replace";
    if (!file) return setProblem("Choose a file to upload.");
    if (!carrierId) return setProblem("Choose the carrier.");
    if (!fileType) return setProblem("Choose whether this is a policy file or a commission file.");
    if (!fileDate) return setProblem("Enter the file's date.");
    setBusy(true);
    setProblem(null);
    setClash(null);
    const send = async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("carrier_id", carrierId);
      form.set("file_type", fileType);
      form.set("file_date", fileDate);
      if (agency.trim()) form.set("agency", agency.trim());
      // A preset is "Replace with a corrected file": replacing is the point of it.
      if (replace || preset?.fileDate) form.set("replace", "yes");
      // A different commission statement from the same day: kept beside it (20261103300000).
      else if (mode === "separate") form.set("replace", "no");
      const response = await fetch("/api/app/carrier-files", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as Outcome & { error?: string; code?: string; existing?: Clash };
      if (response.status === 409 && data.code === "would_replace" && data.existing) throw new ClashError(data.existing);
      if (!response.ok) throw new Error(data.error ?? "The file could not be uploaded.");
      return data;
    };
    try {
      // The upload's progress is a toast (2026-10-28); its outcome is also the dialog's result panel,
      // and a refusal stays in the dialog beside the fields to fix, so it ends without one.
      const data = await notify.promise(send, {
        loading: `Uploading ${file.name}…`,
        done: (result) => result.outcome !== "registered" ? "Same file as before · skipped, nothing changed"
          : result.status === "failed" ? { title: "Received, but it cannot be read", treatment: "warn", detail: result.errorDetail ?? undefined }
          : `Uploaded ${file.name}`,
        // A refusal, and a clash (a question in the dialog), stay in the dialog: no failure toast.
        fail: null,
      });
      setDone(data);
      router.refresh();
    } catch (reason) {
      if (reason instanceof ClashError) setClash(reason.existing);
      else setProblem(reason instanceof Error ? reason.message : "The file could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  const carrierName = carriers.find((carrier) => carrier.id === carrierId)?.name ?? "this carrier";

  return (
    <>
      {!controlled && <Button type="button" variant={variant} size={size} title={title} onClick={() => setOpen(true)}>{label}</Button>}
      <Dialog open={open} onOpenChange={(next) => { if (busy) return; setOpen(next); if (!next) reset(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            {/* The title is for screen readers only (owner 2026-11-02); the one short line says what to drop. */}
            <DialogTitle className="sr-only">Upload a carrier file</DialogTitle>
            <DialogDescription>Policy or commission file: CSV, Excel or PDF.</DialogDescription>
          </DialogHeader>

          {done ? (
            <div role="status" className="grid gap-2 text-sm">
              {done.outcome !== "registered" ? (
                <p className="text-[var(--body)]">This exact file was already received, so it was not stored again. Nothing changed.</p>
              ) : done.status === "failed" ? (
                <p className="text-[var(--error-ink)]">Received, but it cannot be read: {done.errorDetail}</p>
              ) : (
                <p className="text-[var(--body)]">Received {FILE_TYPE_LABELS[fileType as CarrierFileType].toLowerCase()} file from {carrierName}, dated {fileDay(fileDate)}. It is read in the next few seconds and shows in the list.{done.supersededFileId ? " It replaces the earlier file for that day, which is kept." : ""}</p>
              )}
            </div>
          ) : clash ? (
            <div role="alert" className="grid gap-2 text-sm">
              <p className="m-0 font-medium text-[var(--ink)]">Is this a corrected copy of {clash.name}?</p>
              <p className="m-0 text-[var(--body)]">{fileType === "commissions"
                ? "Replacing takes that file's lines out of the books (it stays listed). A different statement is kept beside it."
                : <>One {FILE_TYPE_LABELS[fileType as CarrierFileType].toLowerCase()} file counts per day: replacing takes that file&apos;s lines out of the books (it stays listed). A different file? Use the date printed on it.</>}</p>
            </div>
          ) : (
            <div className="grid gap-4 text-sm">
              <div className="grid gap-1.5">
                <Label htmlFor="carrier-file">File</Label>
                <Input id="carrier-file" type="file" accept={CARRIER_FILE_ACCEPT} onChange={(event) => choose(event.target.files?.[0])} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="carrier-file-carrier">Carrier</Label>
                <select id="carrier-file-carrier" className={selectClass} value={carrierId} onChange={(event) => setCarrierId(event.target.value)}>
                  <option value="">Choose a carrier</option>
                  {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="carrier-file-type">Type</Label>
                  <select id="carrier-file-type" className={selectClass} value={fileType} onChange={(event) => setFileType(event.target.value as CarrierFileType | "")}>
                    <option value="">Choose a type</option>
                    {(Object.keys(FILE_TYPE_LABELS) as CarrierFileType[]).map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="carrier-file-date">File date</Label>
                  <Input id="carrier-file-date" type="date" className="h-9" value={fileDate} onChange={(event) => setFileDate(event.target.value)} />
                </div>
              </div>
              {/* No Agency field (owner 2026-11-02): a corrected or missing file's preset agency is still sent, so it
                  replaces the right file; a new upload has none. */}
              {problem && <p role="alert" className="text-sm font-medium text-[var(--error-ink)]">{problem}</p>}
            </div>
          )}

          <DialogFooter>
            {done ? (
              <>
                <Button type="button" variant="outline" onClick={reset}>Upload another</Button>
                {openWhenDone
                  ? <Button type="button" onClick={() => { const id = done.fileId; setOpen(false); reset(); if (id) router.push(fileHref(id)); }}>Open the file</Button>
                  : <Button type="button" onClick={() => { setOpen(false); reset(); }}>Done</Button>}
              </>
            ) : clash ? (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setClash(null)}>{fileType === "commissions" ? "Change the date" : "No, change the date"}</Button>
                {fileType === "commissions" && <Button type="button" variant="outline" disabled={busy} onClick={() => void submit("separate")}>It&apos;s a different statement</Button>}
                <Button type="button" disabled={busy} onClick={() => void submit("replace")}>{busy ? "Uploading…" : "Yes, it replaces it"}</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
                <Button type="button" disabled={busy || !file} onClick={() => void submit()}>{busy ? "Uploading…" : "Upload"}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
