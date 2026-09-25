import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { LegalDocumentBody } from "@/components/public/legal-document-body";
import { fetchDocument } from "@/lib/legal/queries";
import { LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";

/** "2 April 2026", in UTC so an effective date never shifts a day with the reader's timezone. */
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const longDate = (iso: string) => LONG.format(new Date(iso));

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
      <main className="m-stagger flex justify-center px-4 py-12 sm:px-6 lg:px-16">
        <div className="w-full max-w-[780px]">
          {doc.is_draft && (
            <div className="rounded-xl border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5">
              <div className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">
                This is a draft
              </div>
              <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
                It has not been reviewed by a lawyer and is not final.
              </p>
            </div>
          )}

          {isSuperseded && (
            <div className="mt-4 rounded-xl border border-border border-l-[3px] border-l-[var(--muted)] bg-[var(--surface-alt)] px-4 py-3.5 first:mt-0">
              <div className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">
                You are reading version {doc.version}, which has been superseded
              </div>
              <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
                Version {current!.version} took effect on {longDate(current!.effective_date)}. This text stays here because people accepted it, and what they
                accepted is what it says.{" "}
                <a href={`/legal/${doc.doc_type}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                  Read the current version
                </a>
                .
              </p>
            </div>
          )}

          <div className="mt-6 rounded-xl border border-border bg-card p-6 first:mt-0 sm:p-10">
            <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--accent-ink)]">
              Version {doc.version} · effective {longDate(doc.effective_date)}
            </div>
            <h1 className="mt-2.5 text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
              {doc.title}
            </h1>

            <LegalDocumentBody content={doc.content} title={doc.title} className="mt-6" />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
