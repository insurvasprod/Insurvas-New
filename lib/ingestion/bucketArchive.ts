import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { carrierFileStorage } from "./supabaseStorage";

/**
 * Carrier files › Bucket (2026-10-09, 20261009160000): a file deleted from the bucket is put back.
 *
 * The bucket object is the only copy of a file's bytes, so each bucket file gets a private copy in
 * the archive (<tenant id>/<file id>). Check now and the five-minute poll copy any missing file
 * back to its own path from there, so the agency's folder looks as it did and nothing is marked
 * removed. A file with no copy still follows the removal rules (20261009150000).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

type Listed = { tenant_id: string; file_id: string; storage_path: string; archive_path: string };

/** The archive key of a bucket file. */
export const archiveKey = (tenantId: string, fileId: string) => `${tenantId}/${fileId}`;

/** The private copy of one file just registered from the bucket. Never fails the caller. */
export async function archiveBucketFile(tenantId: string, fileId: string, bytes: Uint8Array): Promise<void> {
  await carrierFileStorage().archive(archiveKey(tenantId, fileId), bytes).catch((failure) => {
    console.error(`[bucket-archive] ${fileId} was not copied; the next check copies it:`, failure);
  });
}

async function listed(rpc: string, tenantId: string | null, limit: number): Promise<Listed[] | null> {
  const { data, error } = await db().rpc(rpc, { p_tenant_id: tenantId, p_limit: limit });
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`Could not list the bucket files (${rpc}): ${error.message}`);
  }
  return (data ?? []) as Listed[];
}

/** Copies every bucket file that has no private copy yet (older drops, or a copy that failed). */
export async function archiveBucketFiles(tenantId: string | null, limit = 50): Promise<{ available: boolean; copied: number; failed: number }> {
  const files = await listed("bucket_files_to_archive", tenantId, limit);
  if (!files) return { available: false, copied: 0, failed: 0 };
  let copied = 0;
  for (const file of files) {
    try {
      await carrierFileStorage().archiveFrom(file.storage_path, file.archive_path);
      copied++;
    } catch (failure) {
      console.error(`[bucket-archive] ${file.file_id} was not copied:`, failure);
    }
  }
  return { available: true, copied, failed: files.length - copied };
}

/** Puts every file missing from the bucket back at its own path, from its private copy. */
export async function putBackMissingFiles(tenantId: string | null, limit = 50): Promise<{ available: boolean; putBack: number; failed: number }> {
  const files = await listed("bucket_files_to_put_back", tenantId, limit);
  if (!files) return { available: false, putBack: 0, failed: 0 };
  let putBack = 0;
  for (const file of files) {
    try {
      await carrierFileStorage().putBack(file.archive_path, file.storage_path);
      putBack++;
    } catch (failure) {
      console.error(`[bucket-archive] ${file.file_id} could not be put back:`, failure);
    }
  }
  // A file marked removed before it had a copy is back at its path now: marked restored, read again.
  if (putBack) {
    const { error } = await db().rpc("sync_carrier_bucket_removals", { p_tenant_id: tenantId });
    if (error) console.error("[bucket-archive] the files put back could not be marked restored; the next check does:", error.message);
  }
  return { available: true, putBack, failed: files.length - putBack };
}
