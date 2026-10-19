import { NextResponse } from "next/server";

import { body, failure } from "@/lib/applications/http";
import { revokeGrants } from "@/lib/extension/grants";
import { actorOf } from "@/lib/extension/http";
import { revokeSchema } from "@/lib/extension/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { rowVisible, scopeFor } from "@/lib/agency/visibility";

type GrantOwnerRead = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: { user_id: string | null } | null }> };
      };
    };
  };
};

/**
 * LA-3.12 · revoke. `{ grant_id }` revokes one (a producer only their own); `{}` revokes every live
 * grant in the agency and is owner-only. The extension's next request is refused.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, revokeSchema);
  if (input instanceof NextResponse) return input;
  // AG-0.5: inside an agency a narrow session must not learn that another producer's grant exists. The
  // service answers 403 "not yours" for one; here such a grant is 404, as if it did not exist.
  if (input.grant_id) {
    const scope = await scopeFor(auth.context);
    if (scope !== null) {
      const { data } = await (getSupabaseServiceClient() as unknown as GrantOwnerRead)
        .from("tenant_extension_grants")
        .select("user_id")
        .eq("tenant_id", auth.context.tenantId)
        .eq("id", input.grant_id)
        .maybeSingle();
      if (!rowVisible(scope, data?.user_id)) return NextResponse.json({ error: "That grant could not be found." }, { status: 404 });
    }
  }
  try {
    return NextResponse.json(await revokeGrants(actorOf(auth, request), input.grant_id ?? null));
  } catch (error) {
    return failure(error);
  }
}
