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
    // PERF_TRACE=1 (scripts/perf): one line per database request with its duration, for finding
    // round trips that wait on each other. Off unless the variable is set.
    ...(process.env.PERF_TRACE === "1" ? { global: { fetch: tracedFetch } } : {}),
  });

  return _client;
}

const tracedFetch: typeof fetch = async (input, init) => {
  const started = performance.now();
  const response = await fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // Filter values are masked: the trace names tables and columns, never what was looked up.
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/=(\w+)\.[^&]*/g, "=$1.…").slice(0, 160);
  console.log(`[perf-trace] ${Math.round(started)} +${Math.round(performance.now() - started)}ms ${init?.method ?? "GET"} ${response.status} ${path}`);
  return response;
};
