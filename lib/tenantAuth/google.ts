import "server-only";

import { createClient, type User } from "@supabase/supabase-js";

/**
 * Sign in and sign up with Google (owner, 2026-10-27), through Supabase Auth's Google provider.
 *
 * Supabase already owns the Auth users and their passwords, so Google is one more identity on the
 * same Auth user: no new dependency, no token checking of our own. The exchange runs on the server
 * with PKCE. The start route keeps the verifier in a short httpOnly cookie, and the callback hands it
 * back to exchange Google's code. Everything after "we know the Auth user" is completeTenantSignIn,
 * the same path as the password.
 */

/** The PKCE verifier and what the person was doing, between the start route and the callback. */
export const GOOGLE_FLOW_COOKIE = "insurvas_google_flow";
export const googleFlowCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // Only the callback reads it.
  path: "/api/app/auth/google",
  maxAge: 10 * 60,
};

export type { GoogleFlow, GoogleIntent } from "./googleProfile.ts";

const STORAGE_KEY = "insurvas-google";
const VERIFIER_KEY = `${STORAGE_KEY}-code-verifier`;

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase Auth environment configuration.");
  return { url, key };
}

/** A Supabase client for one request whose storage is a plain object, so the verifier can be read and given back. */
function oauthClient(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  const { url, key } = supabaseEnv();
  const client = createClient(url, key, {
    auth: { flowType: "pkce", storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, store };
}

/**
 * Whether the Google provider is switched on in the Supabase project. The buttons show only then,
 * so nothing broken appears before the owner has set Google up, and they appear by themselves after.
 * Cached for five minutes; any failure reads as "off" (sign-in by email still works).
 */
export async function googleSignInEnabled(): Promise<boolean> {
  try {
    const { url, key } = supabaseEnv();
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, next: { revalidate: 300 } });
    if (!response.ok) return false;
    const body = (await response.json()) as { external?: Record<string, boolean> };
    return body.external?.google === true;
  } catch {
    return false;
  }
}

/** Where Google sends the person back to: always this app's configured address, never the request's Host. */
export function googleCallbackUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL must be set for Google sign-in.");
  return `${base}/api/app/auth/google/callback`;
}

/** The Google consent URL, and the verifier the callback will need. */
export async function startGoogleSignIn(): Promise<{ url: string; verifier: string } | null> {
  const { client, store } = oauthClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    // `select_account`: someone signed in to two Google accounts picks which one, every time.
    options: { redirectTo: googleCallbackUrl(), skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  const verifier = store.get(VERIFIER_KEY);
  if (error || !data.url || !verifier) {
    if (error) console.error("[google] could not start:", error.message);
    return null;
  }
  return { url: data.url, verifier };
}

/** Exchanges Google's code for the Auth user. Null when the code or the verifier is not good. */
export async function finishGoogleSignIn(code: string, verifier: string): Promise<User | null> {
  const { client } = oauthClient({ [VERIFIER_KEY]: verifier });
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    if (error) console.error("[google] code exchange failed:", error.message);
    return null;
  }
  return data.user;
}

export { googleAccountState, googleProfile, parseGoogleFlow, type GoogleAccountState, type GoogleProfile } from "./googleProfile.ts";
