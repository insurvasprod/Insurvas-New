/**
 * What a profile picture may be. Shared by the upload route and the profile form, so the browser
 * refuses the same files the server would — before uploading 8 MB to be told no.
 *
 * Pure: no imports, so node --test can run it and either side of the client/server line can use it.
 */
export const AVATAR_BUCKET = "user-avatars";
/** Matches the bucket's file_size_limit (20261005120000). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

const EXTENSION: Record<AvatarType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Null when the file is fine; otherwise the sentence to show the person. */
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "Choose a JPG, PNG or WebP image.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > AVATAR_MAX_BYTES) return "Choose an image under 2 MB.";
  return null;
}

/**
 * The file's first bytes match the type it claims — a renamed document is not an image. JPEG starts
 * FF D8 FF, PNG 89 50 4E 47, WebP "RIFF" then "WEBP" at byte 8.
 */
export function avatarMagicMatches(type: AvatarType, head: Uint8Array): boolean {
  const at = (index: number, ...expected: number[]) => expected.every((byte, offset) => head[index + offset] === byte);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47);
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
}

/** One object per upload, under the person's own folder; a new name every time busts every cache. */
export function avatarObjectPath(userId: string, type: AvatarType, stamp: string) {
  return `${userId}/${stamp}.${EXTENSION[type]}`;
}
