// SA-3.1 · Thin HTTP client for the Whop REST API.
//
// Deliberately not the @whop/sdk package: this needs exactly four endpoints, and a hand-rolled
// client keeps the request and response shapes visible at the call site — which matters while we
// are still confirming them against a real sandbox. `fetchImpl` is injectable so WhopProvider can
// be unit-tested without a network.
//
// Endpoints used (verified against Whop's API reference, 2026-08-30):
//   POST /plans                     create a plan, returns a purchase URL
//   POST /checkout_configurations   create a checkout session carrying metadata
//   POST /payments/{id}/refund      full or partial refund
//   GET  /payments/{id}             read a payment's status

/**
 * FNV-1a over the request body, mixed into every idempotency key.
 *
 * Whop binds a key to the exact request it first saw: replaying the key with a different body is
 * refused with "already used with a different request". A key derived only from what we are
 * creating (plan id, cycle) therefore becomes permanently unusable the moment one request is
 * malformed — the corrected retry can never get through. Including the body means a genuine retry
 * (same bytes) reuses the key, while a corrected request gets a fresh one.
 */
export function idempotencyKey(prefix: string, body: unknown): string {
  const text = JSON.stringify(body ?? {});
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}_${hash.toString(16).padStart(8, "0")}`;
}

export class WhopApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`Whop ${method} ${path} failed with ${status}`);
    this.name = "WhopApiError";
    this.status = status;
    this.body = body;
  }
}

export type WhopClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * Whop prices are decimal numbers in currency units (`10.43` for $10.43); ours are integer cents.
 * This is the one place the two meet, and it is done by building the decimal string rather than
 * dividing, because 44999 / 100 is a float operation and floats are how cents go missing.
 */
export function centsToWhopAmount(cents: number): number {
  if (!Number.isInteger(cents)) throw new Error(`Expected integer cents, got ${cents}`);
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return Number(`${negative ? "-" : ""}${whole}.${fraction}`);
}

/** The reverse, for reading amounts back off a Whop payload without a float round trip. */
export function whopAmountToCents(amount: number | string): number {
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Cannot read "${amount}" as a currency amount`);
  const [, sign, whole, fraction = "0"] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

export class WhopClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WhopClientOptions) {
    if (!options.apiKey) throw new Error("WHOP_API_KEY is not set");
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Every Whop call goes through here, which is why the logging lives here rather than in a
   * decorator around the provider (SA-4.2).
   *
   * `withCallLogging` wraps the PaymentProvider interface, but Whop-specific methods — createPlan,
   * addFreeDays, pauseMembership, createInvoice, getRefundability, promo codes — are not on that
   * interface, so seven call sites reached Whop without ever touching the decorator. The result
   * was an empty provider_calls table alongside real sandbox payments. A method cannot be added
   * that skips this one.
   */
  async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    options?: {
      /**
       * Statuses that are a SUCCESS for this particular call, so the health panel does not count
       * them as failures. The connection probe asks for a payment id that cannot exist: a 404 is
       * the proof it worked. Without this, testing the connection made payments look unhealthy —
       * a monitoring screen made worse by the act of monitoring.
       */
      okStatuses?: readonly number[];
    },
  ): Promise<T> {
    const startedAt = performance.now();
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
    // Whop supports an Idempotency-Key header on writes. Passing ours through means a retry after
    // a timeout cannot create a second plan or a second refund.
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // The network never answered. Recorded as a timeout so "they said nothing" stays distinct
      // from "they said no".
      await this.log(method, path, startedAt, "timeout", null, idempotencyKey);
      throw error;
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    const treatAsOk = response.ok || (options?.okStatuses?.includes(response.status) ?? false);

    await this.log(
      method,
      path,
      startedAt,
      treatAsOk ? "ok" : "error",
      { status: response.status, body: parsed as never },
      idempotencyKey,
    );

    if (!response.ok) throw new WhopApiError(method, path, response.status, parsed);
    return parsed as T;
  }

  /**
   * The request body is deliberately NOT logged.
   *
   * `withCallLogging` builds its payloads by allowlist so nothing sensitive can leak in by
   * accident. At this level the body is whatever the caller passed, so an allowlist is impossible
   * — the method, path, status and duration are what the health panel and a 2am debugging session
   * actually need, and the response is already enough to explain a failure.
   */
  private async log(
    method: string,
    path: string,
    startedAt: number,
    status: "ok" | "error" | "timeout",
    response: { status: number; body: never } | null,
    idempotencyKey?: string,
  ): Promise<void> {
    // Imported dynamically, and the whole thing swallowed. This file is imported directly by
    // provider.test.mjs, which runs under plain node with no tsconfig path mapping — a static
    // import would drag in `@/lib/supabase/service` and fail tests that have nothing to do with
    // logging. Losing a log line must never break a payment either way.
    try {
      const { recordProviderCall } = await import("../logging");
      await recordProviderCall({
        tenantId: null,
        provider: "whop",
        method: `${method} ${path}`,
        request: { method, path },
        response,
        status,
        durationMs: Math.round(performance.now() - startedAt),
        idempotencyKey,
      });
    } catch {
      // Intentionally silent: recordProviderCall already logs its own failures, and this catch
      // exists for the case where the module cannot even be loaded.
    }
  }
}

/**
 * Whop returns the customer-facing checkout link under different names depending on the endpoint
 * and API version. Rather than pin one and 404 silently, read whichever is present and fail loudly
 * if none is — the raw response is in provider_calls either way, so the first real call tells us
 * which it actually was.
 */
export function extractCheckoutUrl(response: Record<string, unknown>): string {
  for (const key of ["purchase_url", "checkout_url", "url", "purchaseUrl", "checkoutUrl"]) {
    const value = response[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  throw new Error(
    `Whop response contained no checkout URL. Keys present: ${Object.keys(response).join(", ")}`,
  );
}
