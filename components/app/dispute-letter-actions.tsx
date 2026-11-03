"use client";

/**
 * LA-4.5 · the dispute letter's two live parts:
 *
 *   DisputeLetterRecipient  who the letter is to: the agency's saved commissions address for that
 *                           carrier (tenant_carrier_commission_contacts), else "<Carrier> /
 *                           Commissions Department". It can be edited for this letter, and an owner
 *                           or bookkeeper can save the edit for every letter to that carrier. It
 *                           prints as plain text.
 *   DisputeLetterPrint      Print. Recording the letter in the audit log happens here, once per
 *                           print (not each time the page is opened). For an account that can make
 *                           decisions, it can also mark the letter's open findings "disputed" (what
 *                           that status means: a letter went to the carrier), on by default.
 */

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ToolbarCheckbox } from "@/components/ui/data-toolbar";

export function DisputeLetterRecipient({ carrierId, carrierName, savedAddress, canSave }: {
  carrierId: string;
  carrierName: string;
  /** The agency's saved commissions address for this carrier (20261007110000), or null. */
  savedAddress: string | null;
  /** Owner or bookkeeper on a full account: may save the address for every letter to this carrier. */
  canSave: boolean;
}) {
  const fallback = `${carrierName}\nCommissions Department`;
  const [saved, setSaved] = useState(savedAddress);
  const [value, setValue] = useState(savedAddress ?? fallback);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const changed = value.trim() !== (saved ?? "").trim() && value.trim().length > 0;

  async function save() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/app/discrepancies/carrier-contact", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: carrierId, address: value }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The address was not saved.");
      setSaved(value.trim());
      setMessage({ tone: "good", text: `Saved: every letter to ${carrierName} starts with this address.` });
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "The address was not saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1 print:hidden">
        <label htmlFor="letter-recipient" className="text-xs font-semibold text-muted-foreground">
          To · {saved ? `${carrierName}'s saved commissions address` : `no address saved for ${carrierName} yet`}
        </label>
        <textarea
          id="letter-recipient"
          rows={4}
          maxLength={600}
          value={value}
          onChange={(event) => { setValue(event.target.value); setMessage(null); }}
          className="w-full max-w-md resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        {canSave && changed && (
          <Button type="button" variant="outline" className="w-fit" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : `Save as ${carrierName}'s address`}
          </Button>
        )}
        {message && <p role={message.tone === "error" ? "alert" : "status"} className={`m-0 text-xs ${message.tone === "error" ? "text-[var(--error-ink)]" : "text-[var(--success-ink)]"}`}>{message.text}</p>}
      </div>
      <p className="m-0 hidden whitespace-pre-line print:block">{value}</p>
    </>
  );
}

export function DisputeLetterPrint({ carrierId, ids, openIds, canMarkDisputed }: {
  carrierId: string;
  /** Every finding the letter lists (what is audited). */
  ids: string[];
  /** The ones still open: the only ones "mark disputed" changes. */
  openIds: string[];
  canMarkDisputed: boolean;
}) {
  const router = useRouter();
  const [markDisputed, setMarkDisputed] = useState(canMarkDisputed && openIds.length > 0);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The same letter as a PDF (pdf-lib on the server), with the recipient as currently typed. Recorded once per download. */
  async function download() {
    setDownloading(true); setError(null);
    try {
      const to = (document.getElementById("letter-recipient") as HTMLTextAreaElement | null)?.value ?? "";
      const response = await fetch("/api/app/discrepancies/letter/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier: carrierId, ids, to }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "The PDF could not be built.");
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "commission-dispute.pdf";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = name; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The PDF could not be built.");
    } finally {
      setDownloading(false);
    }
  }

  async function print() {
    setBusy(true); setError(null);
    const problems: string[] = [];
    try {
      const recorded = await fetch("/api/app/discrepancies/letter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier: carrierId, ids }) });
      if (!recorded.ok) problems.push(((await recorded.json().catch(() => ({}))) as { error?: string }).error ?? "The letter could not be recorded.");
      if (markDisputed && openIds.length) {
        const marked = await fetch("/api/app/discrepancies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: openIds, status: "disputed", note: "Dispute letter printed" }) });
        if (!marked.ok) problems.push(((await marked.json().catch(() => ({}))) as { error?: string }).error ?? "The discrepancies were not marked disputed.");
        else router.refresh();
      }
    } catch {
      problems.push("The letter could not be recorded; it still prints.");
    } finally {
      setBusy(false);
    }
    if (problems.length) setError(problems.join(" "));
    // Printing never waits on the record: the letter is the person's, whatever the network did.
    window.print();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 print:hidden">
      {canMarkDisputed && openIds.length > 0 && (
        <ToolbarCheckbox
          checked={markDisputed}
          disabled={busy}
          onChange={setMarkDisputed}
          label={`Mark ${openIds.length === 1 ? "the open finding" : `the ${openIds.length} open findings`} as disputed`}
          title="Disputed means a letter went to the carrier. Findings already disputed, resolved or written off are left as they are."
        />
      )}
      <Button type="button" variant="outline" disabled={busy || downloading} onClick={() => void download()}>
        <Download aria-hidden="true" />{downloading ? "Building…" : "Download PDF"}
      </Button>
      <Button type="button" variant="outline" disabled={busy || downloading} onClick={() => void print()}>
        <Printer aria-hidden="true" />{busy ? "Recording…" : "Print"}
      </Button>
      {error && <p role="alert" className="m-0 w-full text-right text-sm text-[var(--error-ink)]">{error}</p>}
    </div>
  );
}
