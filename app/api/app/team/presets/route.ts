import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";
import { allMenuItems } from "@/lib/menu/definition";
import { MEMBER_ROLES } from "@/lib/tenantAuth/roles";
import { EXTRA_ROLES, UNHIDEABLE_PAGES } from "@/lib/tenantAuth/teamAccess";
import { savePreset } from "@/lib/tenantTeam/access";

/** Custom team access · a saved combination ("Producer + books"), picked when inviting or editing someone. */
const PAGE_KEYS = new Set(allMenuItems().map((entry) => entry.key).filter((key) => !UNHIDEABLE_PAGES.has(key)));

const bodySchema = z.object({
  name: z.string().trim().min(1, "Name the preset").max(60),
  mainRole: z.enum(MEMBER_ROLES).refine((role) => role !== "owner", "A preset cannot make someone the owner"),
  extraRoles: z.array(z.enum(EXTRA_ROLES)).max(EXTRA_ROLES.length),
  hiddenPages: z.array(z.string().refine((key) => PAGE_KEYS.has(key), "Choose pages from the menu")).max(200),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("custom_team_access", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the preset" }, { status: 400 });
  // An admin holds every role already; a preset whose main role is admin carries no extra roles.
  const preset = { ...parsed.data, extraRoles: parsed.data.mainRole === "admin" ? [] : parsed.data.extraRoles.filter((role) => role !== parsed.data.mainRole) };
  const saved = await savePreset(auth.context.tenantId, auth.context.userId, preset);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.access_preset_saved", targetType: "tenant", targetId: auth.context.tenantId, metadata: { presetId: saved.id, ...preset }, request });
  return NextResponse.json({ ok: true, id: saved.id }, { status: 201 });
}
