import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseServiceClient();
  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, email, name, role, is_active, last_login_at")
    .eq("id", auth.session.sub)
    .maybeSingle();

  if (!admin || !admin.is_active) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({ admin });
}
