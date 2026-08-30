import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_SETTINGS } from "@/lib/settings/permissions";
import { getAllSettings, setSetting } from "@/lib/settings/queries";
import { isSettingKey, settingDef, coerceSettingValue, settingRefusalReason } from "@/lib/settings/constants";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;

  try {
    const settings = await getAllSettings();
    return NextResponse.json({
      settings: settings.map((s) => ({
        key: s.def.key,
        value: s.value,
        isOverridden: s.isOverridden,
        updatedAt: s.updatedAt,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Could not load settings" }, { status: 500 });
  }
}

/**
 * Saves one setting.
 *
 * One key per request, not a whole-form submit: SA-4.3's criterion is that every section saves
 * independently, and a single giant form is the thing it exists to avoid. It also means a value
 * the store refuses cannot take three good ones down with it.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const key = (body as { key?: unknown } | null)?.key;
  const rawValue = (body as { value?: unknown } | null)?.value;

  if (typeof key !== "string" || !isSettingKey(key)) {
    // Naming the key back is safe — these are not secrets, and "unknown setting" with no name is
    // a support ticket rather than a fix.
    return NextResponse.json({ error: `Unknown setting: ${String(key)}` }, { status: 400 });
  }

  const def = settingDef(key)!;
  const refusal = settingRefusalReason(def, rawValue);
  if (refusal) {
    return NextResponse.json({ error: refusal, key }, { status: 400 });
  }

  const value = coerceSettingValue(def, rawValue)!;

  try {
    const change = await setSetting(key, value, auth.session.sub);

    // Nothing moved — no row rewritten, and no audit entry, because an audit log full of
    // "changed 72 to 72" is an audit log nobody reads.
    if (!change) {
      return NextResponse.json({ ok: true, key, value, changed: false });
    }

    await audit({
      actorId: auth.session.sub,
      action: "setting.updated",
      targetType: "setting",
      targetId: key,
      metadata: { changes: { [key]: { from: change.from, to: change.to } } },
      request,
    });

    return NextResponse.json({ ok: true, key, value, changed: true });
  } catch {
    return NextResponse.json({ error: "Could not save this setting" }, { status: 500 });
  }
}
