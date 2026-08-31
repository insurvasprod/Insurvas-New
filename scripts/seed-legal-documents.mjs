// SA-5.4 · Publishes the v1 legal documents from content/legal/.
//
// These are DRAFTS — written so the acceptance machinery could be built and tested against real
// text instead of placeholder filler, and marked is_draft so every reader is told so. Replace them
// by publishing v2 from the admin screen once counsel has supplied real copy.
//
// Safe to re-run: it publishes nothing if a version already exists for that document type.
// Run with: npm run legal:seed
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DOCS = [
  { doc_type: "tos", title: "Terms of Service", file: "content/legal/tos-v1.md" },
  { doc_type: "privacy", title: "Privacy Policy", file: "content/legal/privacy-v1.md" },
];

for (const doc of DOCS) {
  const { data: existing } = await supabase
    .from("legal_documents").select("version").eq("doc_type", doc.doc_type).limit(1);

  if (existing?.length) {
    console.log(`${doc.title}: already published (v${existing[0].version}) — nothing to do.`);
    continue;
  }

  const content = readFileSync(doc.file, "utf8");

  // Inserted directly rather than through publish_legal_document, because that function forces
  // is_draft = false. A seeded draft must be honest about being one.
  const { data, error } = await supabase
    .from("legal_documents")
    .insert({
      doc_type: doc.doc_type,
      version: 1,
      effective_date: new Date().toISOString().slice(0, 10),
      title: doc.title,
      content,
      change_summary: null,
      requires_reacceptance: true,
      is_draft: true,
      published_by: null,
    })
    .select("id, version")
    .single();

  if (error) {
    console.error(`${doc.title}: FAILED — ${error.message}`);
    process.exit(1);
  }
  console.log(`${doc.title}: published v${data.version} (${content.length} chars, marked DRAFT)`);
}

console.log("\nThese are drafts, not reviewed by counsel. Publish v2 from /admin/legal to replace them.");
