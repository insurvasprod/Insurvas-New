import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

let _client: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Server-only client authenticated as the service role. admin_users has no
 * anon/authenticated RLS policies, so every admin-auth query goes through
 * this client instead of a publishable key.
 */
export function getSupabaseServiceClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase admin env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  _client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _client;
}
