import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getTenantSession, resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
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
  // Both keyed by the verified session, so fetched together; the context is still checked first.
  const session = await getTenantSession();
  if (!session) redirect("/app/login");
  const [context, outstanding] = await Promise.all([resolveTenantContext(), outstandingDocuments(session.sub)]);
  if (!context) redirect("/app/login");

  // Nothing owed — they arrived by typing the URL, or accepted in another tab.
  if (outstanding.length === 0) redirect("/app/dashboard");

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
    <div className="portal-agent flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] px-4 py-10 sm:p-10">
      {/* Not a direct `main` child: the shell's `.portal-agent > main` reserves 264px for a sidebar
          this screen does not have, which pushed the card off centre. */}
      <div className="w-full max-w-[820px]">
        <main>
          <AcceptTermsPanel documents={documents} />
        </main>
      </div>
    </div>
  );
}
