import { NextResponse } from "next/server";

import { documentsRequiredAtSignup } from "@/lib/legal/acceptance";

/**
 * The document versions a signup must accept, for the form to link to and submit back.
 *
 * Metadata only — no `content`. The text is served by the /legal pages, which is where anyone
 * reading it should end up, and shipping several kilobytes of legal prose into a form that only
 * needs a title and an id is waste.
 */
export async function GET() {
  const { documents, missing } = await documentsRequiredAtSignup();

  return NextResponse.json({
    documents: documents.map((doc) => ({
      id: doc.id,
      doc_type: doc.doc_type,
      version: doc.version,
      title: doc.title,
      is_draft: doc.is_draft,
    })),
    // Surfaced rather than hidden: the form must not show a tickable box for a document that does
    // not exist, and the operator needs to know why signup is refusing.
    missing,
  });
}
