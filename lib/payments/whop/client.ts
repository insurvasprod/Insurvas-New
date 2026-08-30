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

  async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
    // Whop supports an Idempotency-Key header on writes. Passing ours through means a retry after
    // a timeout cannot create a second plan or a second refund.
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!response.ok) throw new WhopApiError(method, path, response.status, parsed);
    return parsed as T;
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
