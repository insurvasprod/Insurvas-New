/**
 * LA-4.1 (Notion sprint) · the storage adapter.
 *
 * Every door and every later stage reaches the original files through this interface and nothing
 * else. It names no provider and carries no provider type, so moving from Supabase Storage to
 * DigitalOcean Spaces, S3 or Google Drive is a new implementation plus a setting — not a change
 * anywhere else (an LA-4.1 acceptance criterion, pinned by ingestion.test.mjs).
 *
 * Paths are always "<tenant id>/…": an implementation never sees a path for another workspace.
 *
 * Pure (types only); relative imports only.
 */

export interface StorageAdapter {
  /** Stores the bytes at the path and returns the storage path that reads them back. */
  put(path: string, bytes: Uint8Array, contentType?: string | null): Promise<string>;
  /** The bytes at a storage path. Throws StorageNotFoundError when there is nothing there. */
  get(path: string): Promise<Uint8Array>;
  /** Every stored path under a prefix (recursively), in no particular order. */
  list(prefix: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  /** Removes an object nothing points at (a failed or duplicate registration). Missing is fine. */
  remove(path: string): Promise<void>;
  /** A short-lived link to download the original, named as it was received. */
  signedUrl(path: string, seconds: number, downloadName: string): Promise<string>;
  /**
   * The private copy of a bucket file (20261009160000), kept apart from the agency's folders under
   * its own key, so a file deleted from the bucket can be put back. Writing a key twice is fine.
   */
  archive(key: string, bytes: Uint8Array): Promise<void>;
  /** Copies the bytes at a storage path into the archive under the key. */
  archiveFrom(path: string, key: string): Promise<void>;
  /** Copies an archived file back to its storage path. */
  putBack(key: string, path: string): Promise<void>;
}

export class StorageNotFoundError extends Error {
  constructor(path: string) {
    super(`No stored file at ${path}`);
    this.name = "StorageNotFoundError";
  }
}

/** Which implementation a deployment uses: CARRIER_FILE_STORAGE, "supabase" unless set. */
export const STORAGE_PROVIDERS = ["supabase"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export function storageProviderFrom(value: string | undefined | null): StorageProvider {
  const wanted = (value ?? "").trim().toLowerCase() || "supabase";
  if ((STORAGE_PROVIDERS as readonly string[]).includes(wanted)) return wanted as StorageProvider;
  throw new Error(`CARRIER_FILE_STORAGE="${value}" is not a storage provider this build has (${STORAGE_PROVIDERS.join(", ")}).`);
}
