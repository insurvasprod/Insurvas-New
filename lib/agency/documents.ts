import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AgencyRefusal } from "./rpc";

/**
 * AG-1.10 · onboarding documents (E&O certificate, W-9) in the private `agency-documents` bucket. The path holds
 * no name and no number — only ids — and a document is read back through a 60-second signed link, never inlined.
 * Nothing here is sent to an AI provider.
 */

const BUCKET = "agency-documents";
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storage = () => (getSupabaseServiceClient() as any).storage.from(BUCKET);

export async function storeOnboardingDocument(tenantId: string, producerId: string, item: "eo" | "w9", file: File): Promise<string> {
  if (!ALLOWED.has(file.type)) throw new AgencyRefusal("Upload a PDF, PNG or JPEG.", "file_type", 400);
  if (file.size > MAX_BYTES) throw new AgencyRefusal("The file is larger than 10 MB.", "file_size", 400);
  const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const path = `${tenantId}/${producerId}/${item}-${crypto.randomUUID()}.${extension}`;
  const { error } = await storage().upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new Error(`storeOnboardingDocument: ${error.message}`);
  return path;
}

export async function signedDocumentLink(path: string): Promise<string | null> {
  const { data, error } = await storage().createSignedUrl(path, 60);
  return error ? null : (data?.signedUrl as string | null) ?? null;
}
