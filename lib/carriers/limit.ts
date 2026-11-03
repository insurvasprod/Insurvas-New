// SA-2.5 · plans.max_carriers. save_tenant_carrier refuses a NEW carrier past the plan's limit with
// 'carrier_limit_reached:<held>:<limit>' (20261015601000); this turns that into the 403 the routes
// send. Plain module so the tests run it under `node --experimental-strip-types`.

export class CarrierLimitError extends Error {
  readonly status = 403;
  readonly code = "carrier_limit_reached";
  readonly held: number;
  readonly limit: number;
  constructor(held: number, limit: number) {
    super(carrierLimitMessage(held, limit));
    this.name = "CarrierLimitError";
    this.held = held;
    this.limit = limit;
  }
}

export function carrierLimitMessage(held: number, limit: number): string {
  const plural = (n: number) => `${n} carrier${n === 1 ? "" : "s"}`;
  return `Your plan allows ${plural(limit)} and you already work with ${plural(held)}. Upgrade your plan to add another, or update one you already have.`;
}

/** The refusal in a database error message, or null when the error is something else. */
export function parseCarrierLimit(message: string | null | undefined): { held: number; limit: number } | null {
  const match = /carrier_limit_reached:(\d+):(\d+)/.exec(message ?? "");
  return match ? { held: Number(match[1]), limit: Number(match[2]) } : null;
}
