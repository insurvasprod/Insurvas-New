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

const selectClass = `${toolbarControl} w-full`;

type Outcome =
  | { outcome: "registered"; status: "received" | "failed"; errorDetail: string | null; supersededFileId: string | null }
  | { outcome: "skipped" };

/**
 * LA-4.1 (Notion sprint) · the upload door. The agent drops a carrier's file and says which carrier,
 * which kind of file and which day it is — filled in from the file name when the name says so. The
 * file is never opened to decide those; it is stored as it came and registered.
 */
export function CarrierFileUploadButton({ carriers, autoOpen = false }: { carriers: CarrierChoice[]; autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [file, setFile] = useState<File | null>(null);
  const [carrierId, setCarrierId] = useState("");
  const [fileType, setFileType] = useState<CarrierFileType | "">("");
  const [fileDate, setFileDate] = useState("");
  const [agency, setAgency] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);

  function reset() {
    setFile(null); setCarrierId(""); setFileType(""); setFileDate(""); setAgency(""); setProblem(null); setDone(null);
  }

  function choose(next: File | undefined) {
    setProblem(null);
    setDone(null);
    if (!next) { setFile(null); return; }
    if (!carrierFileKind(next)) { setFile(null); setProblem("Choose a CSV, an Excel (.xlsx) or a PDF file."); return; }
    if (next.size > MAX_UPLOAD_BYTES) { setFile(null); setProblem(`That file is larger than ${MAX_UPLOAD_BYTES / 1_000_000} MB. Have it dropped into the agency's bucket instead, or split it.`); return; }
    setFile(next);
    const filled = prefillFromFilename(next.name, carriers);
    if (filled.carrierId) setCarrierId(filled.carrierId);
    if (filled.fileType) setFileType(filled.fileType);
    if (filled.fileDate) setFileDate(filled.fileDate);
  }

  async function submit() {
    if (!file) return setProblem("Choose a file to upload.");
    if (!carrierId) return setProblem("Choose the carrier.");
    if (!fileType) return setProblem("Choose whether this is a policy file or a commission file.");
    if (!fileDate) return setProblem("Enter the file's date.");
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("carrier_id", carrierId);
      form.set("file_type", fileType);
      form.set("file_date", fileDate);
      if (agency.trim()) form.set("agency", agency.trim());
      const response = await fetch("/api/app/carrier-files", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as Outcome & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The file could not be uploaded.");
      setDone(data);
      router.refresh();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "The file could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  const carrierName = carriers.find((carrier) => carrier.id === carrierId)?.name ?? "this carrier";

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>Upload a file</Button>
      <Dialog open={open} onOpenChange={(next) => { if (busy) return; setOpen(next); if (!next) reset(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Upload a carrier file</DialogTitle>
            <DialogDescription>A policy file or a commission file, as the carrier&apos;s portal gave it: CSV, Excel or PDF.</DialogDescription>
          </DialogHeader>

          {done ? (
            <div role="status" className="grid gap-2 text-sm">
              {done.outcome === "skipped" ? (
                <p className="text-[var(--body)]">This exact file was already received, so it was not stored again.</p>
              ) : done.status === "failed" ? (
                <p className="text-[var(--error-ink)]">Received, but it cannot be read: {done.errorDetail}</p>
              ) : (
                <p className="text-[var(--body)]">Received {FILE_TYPE_LABELS[fileType as CarrierFileType].toLowerCase()} file from {carrierName}, dated {fileDay(fileDate)}. It is read in the next few seconds and shows in the list.{done.supersededFileId ? " It replaces the earlier file for that day, which is kept." : ""}</p>
              )}
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
                  <p className="text-xs text-muted-foreground">The day the carrier ran the report.</p>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="carrier-file-agency">Agency (optional)</Label>
                <Input id="carrier-file-agency" className="h-9" maxLength={120} value={agency} onChange={(event) => setAgency(event.target.value)} />
                <p className="text-xs text-muted-foreground">Only if the carrier sends a separate file for each agency or downline.</p>
              </div>
              {problem && <p role="alert" className="text-sm font-medium text-[var(--error-ink)]">{problem}</p>}
            </div>
          )}

          <DialogFooter>
            {done ? (
              <>
                <Button type="button" variant="outline" onClick={reset}>Upload another</Button>
                <Button type="button" onClick={() => { setOpen(false); reset(); }}>Done</Button>
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
