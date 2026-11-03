import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { memberSnapshot, recordSettingsChanges } from "@/lib/settingsAudit/record";
import { audit } from "@/lib/audit/log";
import { allMenuItems } from "@/lib/menu/definition";
import { EXTRA_ROLES, UNHIDEABLE_PAGES } from "@/lib/tenantAuth/teamAccess";
import { setMemberAccess } from "@/lib/tenantTeam/access";

/**
 * Custom team access · a member's extra roles and hidden pages (docs/team-access/DESIGN.md). The owner or an admin,
 * with the add-on; never for themselves, never for the billing owner — tenant_set_member_access enforces all of it
 * again in the database. Every change is audited with its before and after (LA-8.8).
 */
const PAGE_KEYS = new Set(allMenuItems().map((entry) => entry.key).filter((key) => !UNHIDEABLE_PAGES.has(key)));

const bodySchema = z.object({
  extraRoles: z.array(z.enum(EXTRA_ROLES)).max(EXTRA_ROLES.length),
  hiddenPages: z.array(z.string().refine((key) => PAGE_KEYS.has(key), "Choose pages from the menu")).max(200),
}).strict();

export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireFeatureRole("custom_team_access", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose roles and pages from the lists" }, { status: 400 });

  const result = await setMemberAccess({ tenantId: auth.context.tenantId, actorId: auth.context.userId, userId, access: parsed.data });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });

  const roles = (list: string[]) => (list.length ? [...list].sort().join(", ") : "none");
  const pages = (list: string[]) => (list.length ? [...list].sort().join(", ") : "none hidden");
  const changes = [
    roles(result.before.extraRoles) !== roles(result.after.extraRoles) ? { key: "extra_roles", label: "extra roles", from: roles(result.before.extraRoles), to: roles(result.after.extraRoles) } : null,
    pages(result.before.hiddenPages) !== pages(result.after.hiddenPages) ? { key: "hidden_pages", label: "hidden pages", from: pages(result.before.hiddenPages), to: pages(result.after.hiddenPages) } : null,
  ].filter((change): change is NonNullable<typeof change> => change !== null);
  if (changes.length) {
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.member_access_changed",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId: auth.context.tenantId, before: result.before, after: result.after },
      request,
    });
    const who = await memberSnapshot(auth.context.tenantId, userId);
    await recordSettingsChanges({
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      section: "team-access",
      changes: changes.map((change) => ({ key: `member:${userId}.${change.key}`, label: `${who.name} — ${change.label}`, from: change.from, to: change.to })),
    });
  }
  return NextResponse.json({ ok: true, userId, ...result.after });
}
