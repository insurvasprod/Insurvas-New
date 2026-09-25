"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LegalDocumentBody } from "@/components/public/legal-document-body";

export type OutstandingDoc = {
  id: string;
  docType: string;
  version: number;
  title: string;
  isDraft: boolean;
  effectiveDate: string;
  changeSummary: string | null;
  content: string;
  previousVersion: number | null;
};

/**
 * "1 October 2026". Effective dates are calendar dates, so they are read in UTC — local time would
 * move a date-only value to the previous day for anyone west of Greenwich.
 */
function effective(date: string) {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * One card, as the board draws it: what the document is, what changed, the full text, and the
 * acceptance — so the person never has to scroll between cards to find the button that unlocks
 * the product. Several outstanding documents share the card, one section each.
 */
export function AcceptTermsPanel({ documents }: { documents: OutstandingDoc[] }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const single = documents.length === 1 ? documents[0] : null;

  async function submit() {
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/app/legal/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: documents.map((doc) => doc.id) }),
    });
    const body = await response.json().catch(() => null);
    setSubmitting(false);

    if (!response.ok) {
      setError(body?.error ?? "Could not record your acceptance");
      return;
    }

    router.push("/app");
    router.refresh();
  }

  return (
    <div className="m-in rounded-lg border border-border bg-card p-6 sm:p-10">
      <h1 className="mt-2 text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
        {single ? `${single.title} — version ${single.version}` : "Updated terms"}
      </h1>
      <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        {single
          ? `Effective ${effective(single.effectiveDate)}. The product is blocked until this is accepted.`
          : `${documents.length} documents have new versions. The product is blocked until they are accepted.`}
      </p>

      {documents.map((doc) => (
        <section key={doc.id} className="mt-6">
          {!single && (
            <header className="mb-3">
              <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">
                {doc.title} — version {doc.version}
              </h2>
              <p className="text-xs leading-normal text-muted-foreground">Effective {effective(doc.effectiveDate)}</p>
            </header>
          )}

          {doc.isDraft && (
            <div className="mb-4 rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
              <span className="font-semibold text-[var(--warning-ink)]">This is a draft</span> and has not been reviewed by a lawyer.
            </div>
          )}

          {/* A plain-language summary, because a diff of legal prose tells a reader nothing. Absent
              rather than faked when nobody wrote one — the previous version is still offered. */}
          {doc.changeSummary ? (
            <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
              <p className="font-semibold text-[var(--info-ink)]">What changed in version {doc.version}</p>
              <p className="mt-1.5 text-[var(--body)]">
                {doc.changeSummary}
                {doc.previousVersion && (
                  <>
                    {" "}
                    <Link href={`/legal/${doc.docType}?v=${doc.previousVersion}`} target="_blank" className="font-semibold text-foreground underline underline-offset-2">
                      Read version {doc.previousVersion}
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>
          ) : (
            doc.previousVersion && (
              <p className="text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
                No summary of changes was recorded.{" "}
                <Link href={`/legal/${doc.docType}?v=${doc.previousVersion}`} target="_blank" className="font-semibold text-foreground underline underline-offset-2">
                  Read version {doc.previousVersion}
                </Link>{" "}
                to compare.
              </p>
            )
          )}

          <div className="mt-5 max-h-[280px] overflow-y-auto rounded-md border border-border bg-card p-5">
            <LegalDocumentBody content={doc.content} />
          </div>
        </section>
      ))}

      {error && (
        <div role="alert" className="mt-5 rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-4 rounded-md bg-[var(--surface-alt)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span>
            I have read and agree to{" "}
            {documents.map((doc, index) => (
              <span key={doc.id}>
                {index > 0 && (index === documents.length - 1 ? " and " : ", ")}
                {single ? `version ${doc.version}` : `${doc.title} v${doc.version}`}
              </span>
            ))}
          </span>
        </label>

        <Button size="lg" className="shrink-0" disabled={!accepted || submitting} onClick={submit}>
          {submitting && <LoaderCircle className="animate-spin" />}
          {submitting ? "Recording…" : "Accept and continue"}
        </Button>
      </div>

      <p className="mt-3.5 text-center text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
        Your acceptance, the timestamp and the version are recorded.
      </p>
    </div>
  );
}
