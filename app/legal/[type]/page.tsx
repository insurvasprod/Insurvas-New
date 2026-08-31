import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SiteHeader } from "@/components/public/site-header";
import { LegalDocumentBody } from "@/components/public/legal-document-body";
import { fetchDocument } from "@/lib/legal/queries";
import { LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";

type Params = { params: Promise<{ type: string }>; searchParams: Promise<{ v?: string }> };

function parse(type: string, v?: string): { docType: LegalDocType; version?: number } | null {
  if (!LEGAL_DOC_TYPES.includes(type as LegalDocType)) return null;
  if (v === undefined) return { docType: type as LegalDocType };

  const version = Number(v);
  if (!Number.isInteger(version) || version < 1) return null;
  return { docType: type as LegalDocType, version };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { type } = await params;
  const parsed = parse(type);
  if (!parsed) return { title: "Not found · Insurvas" };
  const doc = await fetchDocument(parsed.docType);
  return { title: `${doc?.title ?? "Legal"} · Insurvas` };
}

/**
 * A legal document at a given version.
 *
 * `?v=1` keeps working forever after v2 is published — that is the ticket's "the text of v1 is
 * still retrievable" criterion, and it is what makes an acceptance record meaningful: the record
 * stores a version, and this URL turns that version back into the words the person saw.
 */
export default async function LegalPage({ params, searchParams }: Params) {
  const [{ type }, { v }] = await Promise.all([params, searchParams]);

  const parsed = parse(type, v);
  if (!parsed) notFound();

  const doc = await fetchDocument(parsed.docType, parsed.version);
  if (!doc) notFound();

  const current = await fetchDocument(parsed.docType);
  const isSuperseded = current !== null && current.version > doc.version;

  return (
    <div className="min-h-screen bg-[var(--color-page-bg)]">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="rounded-xl bg-white p-8 shadow-[0_18px_50px_rgba(0,64,127,0.10)]">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand-600)]">
            Version {doc.version} · effective {new Date(doc.effective_date).toLocaleDateString()}
          </p>

          {doc.is_draft && (
            <div className="mt-4 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 text-sm">
              <span className="font-bold">This is a draft.</span> It has not been reviewed by a lawyer
              and is not final.
            </div>
          )}

          {isSuperseded && (
            <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-page-bg)] p-4 text-sm">
              This version has been superseded by version {current!.version}. It is kept because
              people accepted it, and what they accepted is what it says here.{" "}
              <a href={`/legal/${doc.doc_type}`} className="font-bold text-[var(--brand-600)] underline">
                Read the current version
              </a>
              .
            </div>
          )}

          <LegalDocumentBody content={doc.content} className="mt-6" />
        </div>
      </main>
    </div>
  );
}
