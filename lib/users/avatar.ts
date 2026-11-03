import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AVATAR_BUCKET, avatarFileProblem, avatarMagicMatches, avatarObjectPath, type AvatarType } from "@/lib/users/avatarRules";

/**
 * Profile pictures (2026-10-05, migration 20261005120000).
 *
 * The file goes to the private `user-avatars` bucket at `<user>/<timestamp>.<ext>` through the
 * service client; nobody reads the bucket directly. The signed-in person's own picture is served by
 * GET /api/app/profile/avatar as a short-lived signed URL. Each upload is a new object, and the old
 * one is removed once the new one is recorded, so a cached old photo is never shown under the new.
 *
 * Before the migration is applied the column and bucket do not exist: reads report "no picture" and
 * an upload is refused with NOT_READY rather than half-done.
 */
export class AvatarError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const NOT_READY = "Profile pictures need a database update that has not been applied yet.";
// The two avatar columns arrive with 20261005120000 and are not in the generated types yet; access
// stays untyped here and nowhere else (as ownProfileService does for its newer table).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;
type DbError = { code?: string; message?: string } | null;

function isMissingColumn(error: DbError) {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /avatar_(path|updated_at)/.test(error.message ?? "")));
}

/** The person's picture, or null when there is none (or the migration is not applied yet). */
export async function readAvatar(userId: string): Promise<{ path: string; version: string } | null> {
  const { data, error } = await db().from("users").select("avatar_path, avatar_updated_at").eq("id", userId).maybeSingle();
  if (error || !data?.avatar_path) return null;
  return { path: String(data.avatar_path), version: String(data.avatar_updated_at ?? "") };
}

/** A signed URL for the person's own picture, valid for `seconds`; null when they have none. */
export async function avatarSignedUrl(userId: string, seconds = 3600): Promise<string | null> {
  const avatar = await readAvatar(userId);
  // The path is checked against the person's own folder, so a tampered row can never serve another file.
  if (!avatar || !avatar.path.startsWith(`${userId}/`)) return null;
  const signed = await db().storage.from(AVATAR_BUCKET).createSignedUrl(avatar.path, seconds);
  return signed.error ? null : signed.data?.signedUrl ?? null;
}

export async function saveAvatar(userId: string, file: File): Promise<{ version: string }> {
  const problem = avatarFileProblem(file);
  if (problem) throw new AvatarError(problem, 400);
  const type = file.type as AvatarType;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!avatarMagicMatches(type, bytes.subarray(0, 12))) throw new AvatarError("That file isn't the image it says it is.", 400);

  // The column decides whether pictures are ready at all; nothing is uploaded before it exists.
  const current = await db().from("users").select("avatar_path").eq("id", userId).maybeSingle();
  if (current.error) throw new AvatarError(isMissingColumn(current.error) ? NOT_READY : "Your picture could not be saved.", 503);

  const stamp = Date.now().toString();
  const path = avatarObjectPath(userId, type, stamp);
  const up = await db().storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) throw new AvatarError(/bucket not found/i.test(up.error.message) ? NOT_READY : "Your picture could not be uploaded.", 503);

  const version = new Date(Number(stamp)).toISOString();
  const set = await db().from("users").update({ avatar_path: path, avatar_updated_at: version }).eq("id", userId).select("id").maybeSingle();
  if (set.error || !set.data) {
    // Not recorded, so nothing points at the new object: take it away again.
    await db().storage.from(AVATAR_BUCKET).remove([path]);
    throw new AvatarError(isMissingColumn(set.error) ? NOT_READY : "Your picture could not be saved.", 503);
  }
  // The previous picture is unreferenced now; removing it is best effort.
  const previous: string | null = current.data?.avatar_path ?? null;
  if (previous && previous !== path && previous.startsWith(`${userId}/`)) await db().storage.from(AVATAR_BUCKET).remove([previous]);
  return { version };
}

export async function removeAvatar(userId: string): Promise<{ removed: boolean }> {
  const current = await db().from("users").select("avatar_path").eq("id", userId).maybeSingle();
  if (current.error) throw new AvatarError(isMissingColumn(current.error) ? NOT_READY : "Your picture could not be removed.", 503);
  const path: string | null = current.data?.avatar_path ?? null;
  if (!path) return { removed: false };
  const cleared = await db().from("users").update({ avatar_path: null, avatar_updated_at: new Date().toISOString() }).eq("id", userId);
  if (cleared.error) throw new AvatarError("Your picture could not be removed.", 503);
  if (path.startsWith(`${userId}/`)) await db().storage.from(AVATAR_BUCKET).remove([path]);
  return { removed: true };
}
