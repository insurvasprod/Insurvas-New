import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getSetting } from "@/lib/settings/queries";

const unlockSchema = z.object({ scopeKey: z.string().trim().min(1).max(600) });

/** Super-admin view of persistent login lockouts; credentials and passwords are never returned. */
export async function GET() {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;
  const [lockoutMinutes, lockoutThreshold] = await Promise.all([
    getSetting<number>("security.lockout_minutes"),
    getSetting<number>("security.lockout_threshold"),
  ]);

  const { data, error } = await getSupabaseServiceClient()
    .from("rate_limits")
    .select("bucket_key, window_start, hits")
    .like("bucket_key", "login_lockout:%")
    .order("window_start", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: "Could not load login protection state" }, { status: 500 });
  return NextResponse.json({
    lockouts: (data ?? []).map((row) => {
      const parts = row.bucket_key.split(":");
      const actorType = parts[2] === "admin" ? "admin" : "user";
      const email = decodeURIComponent(parts[3] ?? "unknown");
      const ip = decodeURIComponent(parts.slice(4).join(":") || "unknown");
      const expiresAt = new Date(new Date(row.window_start).getTime() + lockoutMinutes * 60_000);
      return {
        scope_key: row.bucket_key,
        actor_type: actorType,
        email,
        ip,
        failed_attempts: row.hits,
        last_failed_at: row.window_start,
        locked_until: row.hits >= lockoutThreshold && expiresAt.getTime() > Date.now() ? expiresAt.toISOString() : null,
      };
    }),
  });
}

/** Clears one lockout and its accumulated failed-attempt state, with an append-only audit row. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const parsed = unlockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid login lockout" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  if (!parsed.data.scopeKey.startsWith("login_lockout:login:")) {
    return NextResponse.json({ error: "Choose a valid login lockout" }, { status: 400 });
  }

  const { data: existing, error: lookupError } = await supabase
    .from("rate_limits")
    .select("bucket_key, hits, window_start")
    .eq("bucket_key", parsed.data.scopeKey)
    .maybeSingle();

  if (lookupError) return NextResponse.json({ error: "Could not load login lockout" }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "That login lockout is already clear" }, { status: 404 });

  const { error } = await supabase.from("rate_limits").delete().eq("bucket_key", parsed.data.scopeKey);
  if (error) return NextResponse.json({ error: "Could not clear login lockout" }, { status: 500 });

  await audit({
    actorId: auth.session.sub,
    action: "security.login_unlocked",
    targetType: "login_lockout",
    targetId: parsed.data.scopeKey,
    reason: "Super-admin manual unlock",
    metadata: {
      scopeKey: existing.bucket_key,
      failedAttempts: existing.hits,
      windowStart: existing.window_start,
    },
    request,
  });

  return NextResponse.json({ ok: true, scopeKey: parsed.data.scopeKey });
}
