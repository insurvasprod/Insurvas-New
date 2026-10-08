import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { CARRIER_FILE_ARCHIVE_BUCKET, CARRIER_FILE_BUCKET } from "./constants";
import { StorageNotFoundError, storageProviderFrom, type StorageAdapter } from "./storage";

/**
 * LA-4.1 (Notion sprint) · the StorageAdapter on Supabase Storage — the first implementation, and
 * the only file in the pipeline that talks to it (pinned by ingestion.test.mjs). The bucket is
 * private and reached only with the service role; a link to an original lives sixty seconds.
 *
 * DigitalOcean Spaces (S3-compatible) is the next implementation: a second class here and a value
 * for CARRIER_FILE_STORAGE, with no change outside this folder.
 */
class SupabaseStorageAdapter implements StorageAdapter {
  private bucket() {
    return getSupabaseServiceClient().storage.from(CARRIER_FILE_BUCKET);
  }

  async put(path: string, bytes: Uint8Array, contentType?: string | null): Promise<string> {
    const { error } = await this.bucket().upload(path, bytes, { contentType: contentType ?? "application/octet-stream", upsert: false });
    // The same path twice is the same bytes (the path carries the content hash), so it is already there.
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`The file could not be stored: ${error.message}`);
    return path;
  }

  async get(path: string): Promise<Uint8Array> {
    const { data, error } = await this.bucket().download(path);
    if (error || !data) {
      if (!error || /not found|does not exist|404/i.test(error.message)) throw new StorageNotFoundError(path);
      throw new Error(`The file could not be read: ${error.message}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async list(prefix: string): Promise<string[]> {
    const found: string[] = [];
    const folders = [prefix.replace(/\/+$/, "")];
    while (folders.length) {
      const folder = folders.shift()!;
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await this.bucket().list(folder, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(`The stored files could not be listed: ${error.message}`);
        for (const entry of data ?? []) {
          const full = folder ? `${folder}/${entry.name}` : entry.name;
          // A folder has no id in Supabase Storage's listing.
          if (entry.id) found.push(full);
          else folders.push(full);
        }
        if ((data ?? []).length < 1000) break;
      }
    }
    return found;
  }

  async exists(path: string): Promise<boolean> {
    const slash = path.lastIndexOf("/");
    const { data, error } = await this.bucket().list(path.slice(0, slash), { limit: 1, search: path.slice(slash + 1) });
    if (error) throw new Error(`The stored file could not be checked: ${error.message}`);
    return (data ?? []).some((entry) => entry.id && entry.name === path.slice(slash + 1));
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.bucket().remove([path]);
    if (error && !/not found/i.test(error.message)) throw new Error(`The stored file could not be removed: ${error.message}`);
  }

  async signedUrl(path: string, seconds: number, downloadName: string): Promise<string> {
    const { data, error } = await this.bucket().createSignedUrl(path, seconds, { download: downloadName });
    if (error || !data?.signedUrl) throw new Error(`A download link could not be made: ${error?.message ?? "no link"}`);
    return data.signedUrl;
  }

  // The archive: a second private bucket, one object per bucket file (20261009160000).
  private archiveBucket() {
    return getSupabaseServiceClient().storage.from(CARRIER_FILE_ARCHIVE_BUCKET);
  }

  async archive(key: string, bytes: Uint8Array): Promise<void> {
    const { error } = await this.archiveBucket().upload(key, bytes, { contentType: "application/octet-stream", upsert: false });
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`The file could not be copied to the archive: ${error.message}`);
  }

  async archiveFrom(path: string, key: string): Promise<void> {
    await this.archive(key, await this.get(path));
  }

  async putBack(key: string, path: string): Promise<void> {
    const { data, error } = await this.archiveBucket().download(key);
    if (error || !data) throw new Error(`The archived copy could not be read: ${error?.message ?? "nothing there"}`);
    await this.put(path, new Uint8Array(await data.arrayBuffer()), data.type || null);
  }
}

let adapter: StorageAdapter | null = null;

/** The deployment's storage adapter (CARRIER_FILE_STORAGE; Supabase unless set). */
export function carrierFileStorage(): StorageAdapter {
  if (adapter) return adapter;
  const provider = storageProviderFrom(process.env.CARRIER_FILE_STORAGE);
  switch (provider) {
    case "supabase":
      adapter = new SupabaseStorageAdapter();
      return adapter;
  }
}
