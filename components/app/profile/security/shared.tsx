"use client";

/**
 * What the rows of My profile › Signing in share: the shapes the profile routes answer with, the one
 * fetch helper, and the "could not load" line. Every call is the signed-in person's own.
 */

import { Button } from "@/components/ui/button";

export type TwoFactor = { enabled: boolean; enabledAt: string | null; pending: boolean; recoveryCodesLeft: number; required: boolean; sessionVerified: boolean };
export type Session = { id: string; tenantName: string; createdAt: string; lastSeenAt: string; ip: string | null; location: string | null; device: string; current: boolean; twoFactor: boolean };
export type SecurityEvent = { id: string; type: string; label: string; at: string; ip: string | null; detail?: Record<string, unknown> };

/** A date and time in the person's display timezone. */
export type When = (iso: string) => string;

export async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
    const body = await response.json().catch(() => null);
    return response.ok ? { ok: true, data: body as T } : { ok: false, error: body?.error ?? "That did not work. Nothing changed.", status: response.status };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection.", status: 0 };
  }
}

export const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/** The server's 503: two-step sign-in cannot run on this account yet. Said for the reader, not for us. */
export const TWO_FACTOR_UNAVAILABLE = "Two-step sign-in isn’t ready for your account yet. Ask Insurvas support to switch it on.";

/** A read that failed: said plainly, with a way to try again (redesign, 2026-10-24). */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[var(--error-ink)]">
      <span>Could not load {what}.</span>
      <Button type="button" variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}

/** The error line under a form, read out when it appears. */
export function FormError({ children }: { children: string | null }) {
  return children ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{children}</p> : null;
}
