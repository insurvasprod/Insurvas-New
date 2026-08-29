import "server-only";

// SA-3.1 · "Every provider call logged with its raw request and response."
//
// Built as a decorator rather than as code inside each provider, so a provider class cannot forget
// to log — and so the real Stripe class inherits logging without containing a single line of it.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { ProviderTimeoutError } from "./types";
import type {
  ChargeLookup,
  ChargeResult,
  CreateChargeInput,
  CreateCustomerInput,
  CreateCustomerResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
} from "./types";
import type { CallStatus } from "./constants";
import type { Json as DbJson } from "@/lib/supabase/database.types";

type LogContext = { tenantId: string | null };

/** A jsonb payload, using the database's own Json type so the insert type-checks. */
type Json = { [key: string]: DbJson };

async function writeCall(row: {
  tenantId: string | null;
  provider: string;
  method: string;
  request: Json;
  response: Json | null;
  status: CallStatus;
  durationMs: number;
  idempotencyKey?: string;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("provider_calls").insert({
    tenant_id: row.tenantId,
    provider: row.provider,
    method: row.method,
    request: row.request,
    response: row.response,
    status: row.status,
    duration_ms: row.durationMs,
    idempotency_key: row.idempotencyKey ?? null,
  });

  // Deliberately non-fatal. Losing a debug log line is bad; refusing a customer's payment because
  // a log insert failed is worse. It is shouted into the server log so it cannot pass unnoticed.
  if (error) {
    console.error(`[provider_calls] failed to log ${row.provider}.${row.method}: ${error.message}`);
  }
}

/**
 * Wraps a provider so every call is recorded.
 *
 * Request payloads are built by allowlist — field by field, never by spreading the input object.
 * If a future provider input ever carries something sensitive, it cannot leak into the log by
 * accident; someone has to add it here on purpose.
 */
export function withCallLogging(inner: PaymentProvider, ctx: LogContext): PaymentProvider {
  async function run<T>(
    method: string,
    request: Json,
    call: () => Promise<T>,
    classify: (result: T) => { status: CallStatus; response: Json },
    idempotencyKey?: string,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await call();
      const { status, response } = classify(result);
      await writeCall({
        tenantId: ctx.tenantId,
        provider: inner.code,
        method,
        request,
        response,
        status,
        durationMs: Math.round(performance.now() - startedAt),
        idempotencyKey,
      });
      return result;
    } catch (error) {
      const timedOut = error instanceof ProviderTimeoutError;
      await writeCall({
        tenantId: ctx.tenantId,
        provider: inner.code,
        method,
        request,
        // A timeout has no response. Recording `null` rather than an empty object keeps the
        // difference between "they said nothing" and "they said nothing useful".
        response: timedOut ? null : { error: error instanceof Error ? error.message : String(error) },
        status: timedOut ? "timeout" : "error",
        durationMs: Math.round(performance.now() - startedAt),
        idempotencyKey,
      });
      throw error;
    }
  }

  return {
    code: inner.code,

    createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
      return run(
        "createCustomer",
        { tenantId: input.tenantId, name: input.name, email: input.email },
        () => inner.createCustomer(input),
        (result) => ({ status: "ok", response: { providerCustomerId: result.providerCustomerId } }),
      );
    },

    createCharge(input: CreateChargeInput): Promise<ChargeResult> {
      return run(
        "createCharge",
        {
          amountCents: input.amountCents,
          providerCustomerId: input.providerCustomerId,
          idempotencyKey: input.idempotencyKey,
          description: input.description ?? null,
        },
        () => inner.createCharge(input),
        (result) => ({
          // A decline is a successful round trip with a negative answer, so it is logged as
          // "declined" rather than "error". Only "error" means our code or the network broke.
          status: result.status === "succeeded" ? "ok" : "declined",
          response: { id: result.id, status: result.status, failureReason: result.failureReason ?? null },
        }),
        input.idempotencyKey,
      );
    },

    refund(input: RefundInput): Promise<RefundResult> {
      return run(
        "refund",
        { chargeId: input.chargeId, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey },
        () => inner.refund(input),
        (result) => ({
          status: result.status === "succeeded" ? "ok" : "declined",
          response: { id: result.id, status: result.status },
        }),
        input.idempotencyKey,
      );
    },

    getCharge(chargeId: string): Promise<ChargeLookup> {
      return run(
        "getCharge",
        { chargeId },
        () => inner.getCharge(chargeId),
        (result) => ({ status: "ok", response: { status: result.status } }),
      );
    },
  };
}
