import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { callbackUrlProblem } from "./board";
import type { StatusCallback } from "./service";

/**
 * Round 8 · "Tell the vendor what happened": after a post is answered, we call the vendor's status
 * address with the outcome so they can stop billing bad leads. Sent after the reply (postHandler's
 * `after`), once, with a 5-second limit; the HTTP status it got is kept on the key so the sheet can
 * say "last call 2 min ago, answered". Never throws: the post is already answered.
 *
 * The address is checked again here (https, a public host name) because it is a server-side request
 * to a URL an owner typed.
 */
export async function sendStatusCallback(callback: StatusCallback): Promise<void> {
  if (callbackUrlProblem(callback.url)) return;
  let status = 0;
  try {
    const response = await fetch(callback.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Insurvas-LeadPost/1" },
      body: JSON.stringify(callback.body),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  try {
    await getSupabaseServiceClient()
      .from("tenant_vendor_post_keys")
      .update({ status_callback_last_at: new Date().toISOString(), status_callback_last_status: status } as never)
      .eq("id", callback.keyId);
  } catch {
    // The call itself is what mattered.
  }
}
