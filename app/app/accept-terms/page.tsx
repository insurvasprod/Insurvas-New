import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { outstandingDocuments } from "@/lib/legal/acceptance";
import { fetchDocument } from "@/lib/legal/queries";
import { AcceptTermsPanel } from "@/components/app/accept-terms-panel";

export const metadata: Metadata = { title: "Updated terms · Insurvas" };

/**
 * The one-time acceptance screen.
 *
 * Deliberately OUTSIDE the (shell) route group: the shell redirects here whenever anything is
 * outstanding, so a screen inside it would redirect to itself forever.
 */
export default async function AcceptTermsPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const outstanding = await outstandingDocuments(context.userId);
  // Nothing owed — they arrived by typing the URL, or accepted in another tab.
  if (outstanding.length === 0) redirect("/app");

  // The full text is loaded here rather than linked away to, because "accept without reading" is
  // easier to argue with when the words were on the screen.
  const documents = await Promise.all(
    outstanding.map(async (doc) => {
      const full = await fetchDocument(doc.doc_type, doc.version);
      const previous =
        doc.version > 1 ? await fetchDocument(doc.doc_type, doc.version - 1) : null;
      return {
        id: doc.id,
        docType: doc.doc_type,
        version: doc.version,
        title: doc.title,
        isDraft: doc.is_draft,
        effectiveDate: doc.effective_date,
        changeSummary: doc.change_summary,
        content: full?.content ?? "",
        previousVersion: previous?.version ?? null,
      };
    }),
  );

  return (
    <div className="min-h-screen bg-[var(--color-page-bg)] py-10">
      <main className="mx-auto max-w-3xl px-4 sm:px-6">
        <AcceptTermsPanel documents={documents} />
      </main>
    </div>
  );
}
