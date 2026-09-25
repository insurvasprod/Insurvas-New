"use client";

import { useState, type ChangeEvent } from "react";

import { Callout, Field, KeyValues, btn, control } from "@/components/app/settings/primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatEffectiveDate, PACK_COLUMNS, parsePack, type ParsedPack } from "@/lib/stateDisclosures/board";
import { MAX_PACK_PROPOSALS } from "@/lib/stateDisclosures/schemas";
import { notify } from "@/lib/notify";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SHOWN_ERRORS = 12;

/**
 * Import a pack: a CSV of approved wording (state, product_code, effective_from, required_text),
 * read in the browser, grouped into one proposal per distinct version, and filed for review. An
 * export from this page has the same first four columns. Any bad row stops the whole pack.
 */
export function StateDisclosuresImport({
  reviewAvailable,
  earliest,
  onClose,
  onImported,
}: {
  reviewAvailable: boolean;
  earliest: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pack, setPack] = useState<ParsedPack | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPack(null);
    setError(null);
    setReadError(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setReadError("That file is larger than 2 MB. Split the pack and import it in parts.");
      return;
    }
    try {
      setPack(parsePack(await file.text(), earliest));
    } catch {
      setReadError("That file could not be read as text.");
    }
  }

  const pairs = pack?.proposals.reduce((sum, proposal) => sum + proposal.states.length, 0) ?? 0;
  const tooMany = (pack?.proposals.length ?? 0) > MAX_PACK_PROPOSALS;
  const ready = reviewAvailable && pack !== null && pack.errors.length === 0 && pack.proposals.length > 0 && !tooMany;
  const blocker = !reviewAvailable
    ? "Importing needs the review workflow, which this database does not have yet."
    : !pack
      ? "Choose a CSV file."
      : pack.errors.length
        ? "Fix the rows listed and choose the file again."
        : pack.proposals.length === 0
          ? "The file has no rows with wording."
          : tooMany
            ? `A pack can hold at most ${MAX_PACK_PROPOSALS} distinct versions.`
            : null;

  async function submit() {
    if (!ready || !pack) return;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/admin/state-disclosures/proposals/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_name: fileName ?? undefined, proposals: pack.proposals }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError(body?.error ?? "Could not reach the server. Nothing was imported.");
      return;
    }
    notify.done(`Imported ${pack.proposals.length} version${pack.proposals.length === 1 ? "" : "s"} for review. Another admin has to approve them.`);
    onImported();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em]">Import a pack</DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
            A CSV of approved wording from your compliance source. Every version in it waits for a second admin before
            the dialer reads it.
          </DialogDescription>
        </DialogHeader>

        {!reviewAvailable && (
          <Callout tone="warning" title="Needs a database update">
            Packs are imported as proposals for review, and this database is missing update 20260925507000. Use Add a
            disclosure in the meantime.
          </Callout>
        )}

        <Callout tone="info" title="The file">
          A header row with <code className="font-mono">{PACK_COLUMNS.join(", ")}</code>, one row per state. Effective dates
          from {formatEffectiveDate(earliest)}. States that share a product, date and identical wording become one
          proposal. Rows with no wording are skipped, so an export from this page is a valid starting point.
        </Callout>

        <Field label="CSV file" htmlFor="disclosure-pack-file" required hint="Up to 2 MB.">
          <input id="disclosure-pack-file" type="file" accept=".csv,text/csv" onChange={choose} className={`${control} py-2`} />
        </Field>

        {readError && (
          <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
            {readError}
          </p>
        )}

        {pack && (
          <>
            <KeyValues
              items={[
                { label: "Rows read", value: pack.rows.toLocaleString("en-US") },
                { label: "Skipped, no wording", value: pack.skipped.toLocaleString("en-US") },
                { label: "Versions to propose", value: pack.proposals.length.toLocaleString("en-US") },
                { label: "State and product pairs", value: pairs.toLocaleString("en-US") },
              ]}
            />
            {pack.errors.length > 0 && (
              <Callout tone="error" title={`${pack.errors.length} row${pack.errors.length === 1 ? "" : "s"} need fixing; nothing will be imported`}>
                <ul className="m-0 list-disc space-y-1 pl-5">
                  {pack.errors.slice(0, SHOWN_ERRORS).map((issue) => (
                    <li key={`${issue.line}-${issue.message}`}>
                      Line {issue.line}: {issue.message}
                    </li>
                  ))}
                  {pack.errors.length > SHOWN_ERRORS && <li>…and {pack.errors.length - SHOWN_ERRORS} more.</li>}
                </ul>
              </Callout>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
            {error}
          </p>
        )}
        {!error && blocker && pack && <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{blocker}</p>}

        <DialogFooter>
          <button type="button" className={btn("ghost")} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={btn("primary")} onClick={submit} disabled={saving || !ready} title={blocker ?? undefined}>
            {saving ? "Importing…" : pack?.proposals.length ? `Submit ${pack.proposals.length} for review` : "Submit for review"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
