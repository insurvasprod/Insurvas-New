"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LoaderCircle, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function AcceptTermsPanel({ documents }: { documents: OutstandingDoc[] }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand-600)]">
            <ScrollText className="size-4" />
            {documents.length === 1 ? "An updated document" : "Updated documents"}
          </p>
          <CardTitle className="text-2xl font-extrabold tracking-tight">
            Please review before continuing
          </CardTitle>
          <p className="text-sm text-[var(--color-text-muted)]">
            {documents.length === 1
              ? "We have published a new version of this document."
              : "We have published new versions of these documents."}{" "}
            You need to accept {documents.length === 1 ? "it" : "them"} to keep using Insurvas.
          </p>
        </CardHeader>
      </Card>

      {documents.map((doc) => (
        <Card key={doc.id} className="bg-white">
          <CardHeader>
            <CardTitle className="text-lg font-bold">
              {doc.title} <span className="font-normal text-[var(--color-text-muted)]">v{doc.version}</span>
            </CardTitle>
            <p className="text-xs text-[var(--color-text-muted)]">
              Effective {new Date(doc.effectiveDate).toLocaleDateString()}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {doc.isDraft && (
              <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm">
                <span className="font-bold">This is a draft</span> and has not been reviewed by a lawyer.
              </div>
            )}

            {/* "They can read what changed" — a plain-language summary, because a diff of legal
                prose tells a reader nothing. Absent rather than faked when nobody wrote one. */}
            {doc.changeSummary ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-page-bg)] p-3 text-sm">
                <p className="font-bold">What changed</p>
                <p className="mt-1">{doc.changeSummary}</p>
                {doc.previousVersion && (
                  <Link
                    href={`/legal/${doc.docType}?v=${doc.previousVersion}`}
                    target="_blank"
                    className="mt-2 inline-block font-bold text-[var(--brand-600)] underline"
                  >
                    Read version {doc.previousVersion}
                  </Link>
                )}
              </div>
            ) : (
              doc.previousVersion && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No summary of changes was recorded.{" "}
                  <Link
                    href={`/legal/${doc.docType}?v=${doc.previousVersion}`}
                    target="_blank"
                    className="font-bold text-[var(--brand-600)] underline"
                  >
                    Read version {doc.previousVersion}
                  </Link>{" "}
                  to compare.
                </p>
              )
            )}

            <div className="max-h-96 overflow-y-auto rounded-lg border border-[var(--color-border)] p-4">
              <LegalDocumentBody content={doc.content} />
            </div>
          </CardContent>
        </Card>
      ))}

      <Card className="bg-white">
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--brand-600)]"
            />
            <span>
              I have read and agree to{" "}
              {documents.map((doc, index) => (
                <span key={doc.id}>
                  {index > 0 && (index === documents.length - 1 ? " and " : ", ")}
                  <span className="font-bold">
                    {doc.title} v{doc.version}
                  </span>
                </span>
              ))}
              .
            </span>
          </label>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}

          <Button size="lg" className="w-full" disabled={!accepted || submitting} onClick={submit}>
            {submitting && <LoaderCircle className="animate-spin" />}
            {submitting ? "Recording…" : "Accept and continue"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
