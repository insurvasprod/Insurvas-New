import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { ApplicationKeyMissingError } from "./crypto";
import { ApplicationError } from "./db";

/**
 * The shape every LA-3 route shares: entitlement → role → strict body → service → one error map.
 * Roles are `owner` and `producer` (the Sell menu, and decision 5 for reveal); setters are refused
 * here and again by `start_application_from_lead`.
 */
export const SELL_ROLES = ["owner", "producer"] as const;

export type Actor = { tenantId: string; userId: string; role: string; request: Request };

/**
 * The actor from a guard a route ran itself. Routes call `requireFeatureRole(feature, [roles], …)`
 * in their own body — the money-boundary and plane-isolation tests read the role gate from the
 * route source, so the gate has to be written there, not hidden in a helper.
 */
export function actorOf(auth: { context: { tenantId: string; userId: string; role: string } }, request: Request): Actor {
  return { tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, request };
}

export async function actorFor(request: Request, featureKey: string, opts: { write?: boolean; roles?: readonly ("owner" | "producer" | "assistant" | "bookkeeper" | "setter")[] } = {}): Promise<Actor | NextResponse> {
  const auth = await requireFeatureRole(featureKey, opts.roles ?? SELL_ROLES, { write: opts.write });
  if (auth instanceof NextResponse) return auth;
  return { tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, request };
}

export async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | NextResponse> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message && issue.message !== "Required" ? issue.message : "Check the details and try again.", code: "invalid_request", path: issue?.path?.join(".") }, { status: 400 });
  }
  return parsed.data;
}

export function failure(error: unknown) {
  if (error instanceof ApplicationKeyMissingError) return NextResponse.json({ error: error.message, code: "encryption_key_missing" }, { status: 503 });
  if (error instanceof ApplicationError) {
    return NextResponse.json({ error: error.message, code: error.code, ...(error.code === "SCHEMA_PENDING" ? { schemaPending: true } : {}) }, { status: error.status });
  }
  console.error("[applications]", error);
  return NextResponse.json({ error: "Something went wrong with the application. Try again." }, { status: 500 });
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
