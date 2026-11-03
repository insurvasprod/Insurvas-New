import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { AvatarError, avatarSignedUrl, removeAvatar, saveAvatar } from "@/lib/users/avatar";

/**
 * The signed-in person's own profile picture. Like the rest of Your profile, every role may set its
 * own, and the user comes only from the verified session — there is no way to name someone else.
 *
 *   GET     redirects to a short-lived signed URL of the picture (404 when there is none)
 *   POST    multipart `file`: a JPG, PNG or WebP under 2 MB replaces the picture
 *   DELETE  removes it
 */
export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const url = await avatarSignedUrl(auth.context.userId);
  if (!url) return NextResponse.json({ error: "No profile picture" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  // The page asks with ?v=<upload time>, so a browser may keep this answer for a while: a new upload
  // is a new address. Private, because it is one person's picture behind their session.
  return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, max-age=600" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
  try {
    const saved = await saveAvatar(auth.context.userId, file);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.own_avatar_updated",
      targetType: "user",
      targetId: auth.context.userId,
      metadata: { tenantId: auth.context.tenantId, bytes: file.size, type: file.type },
      request,
    });
    return NextResponse.json({ avatar: { version: saved.version } });
  } catch (error) {
    const status = error instanceof AvatarError ? error.status : 503;
    return NextResponse.json({ error: error instanceof AvatarError ? error.message : "Your picture could not be saved." }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await removeAvatar(auth.context.userId);
    if (result.removed) {
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.own_avatar_removed",
        targetType: "user",
        targetId: auth.context.userId,
        metadata: { tenantId: auth.context.tenantId },
        request,
      });
    }
    return NextResponse.json({ removed: result.removed });
  } catch (error) {
    const status = error instanceof AvatarError ? error.status : 503;
    return NextResponse.json({ error: error instanceof AvatarError ? error.message : "Your picture could not be removed." }, { status });
  }
}
