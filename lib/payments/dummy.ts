// SA-3.1 · The two fake providers.
//
// Pure logic: no database, no logging, no framework. That is the point — logging is added by the
// decorator in logging.ts, and the simulator setting is read by registry.ts and handed in. So the
// real Stripe class, when it arrives, is genuinely just this file's shape with `fetch` in it, and
// it gets call logging for free without knowing logging exists.

// Explicit .ts extension: this is the one runtime import in the file, and dummy.test.mjs loads
// this module directly through Node's test runner, which cannot resolve "./types".
import { ProviderTimeoutError } from "./types.ts";
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
import type { ProviderCode, SimulatedOutcome } from "./constants";

/**
 * FNV-1a. Not a security hash — it only has to turn an input into a stable, readable suffix so the
 * same idempotency key always produces the same fake charge id. Written out rather than imported
 * from node:crypto so this module stays runnable anywhere, including the unit tests.
 */
function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type DummyProviderOptions = {
  /** Sticky simulator setting for the tenant this instance was built for. */
  simulate?: SimulatedOutcome;
};

abstract class DummyProvider implements PaymentProvider {
  abstract readonly code: ProviderCode;
  /** Short prefix so a fake id is recognisable at a glance in the call log. */
  protected abstract readonly slug: string;

  private readonly simulate: SimulatedOutcome;

  constructor(options: DummyProviderOptions = {}) {
    this.simulate = options.simulate ?? "success";
  }

  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    // Derived from the tenant id, so calling this twice for the same tenant returns the same
    // customer rather than quietly creating a duplicate.
    return { providerCustomerId: `cus_${this.slug}_${stableHash(input.tenantId)}` };
  }

  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error(`amountCents must be a positive integer number of cents, got ${input.amountCents}`);
    }

    if (this.simulate === "timeout") {
      throw new ProviderTimeoutError(this.code, "createCharge", input.idempotencyKey);
    }

    // The outcome is encoded in the id itself, which is why getCharge() needs no storage and keeps
    // working across a server restart. A real provider looks this up over the network instead.
    const suffix = stableHash(input.idempotencyKey);

    if (this.simulate === "insufficient_funds" || this.simulate === "expired_card") {
      return { id: `ch_${this.slug}_dec_${suffix}`, status: "failed", failureReason: this.simulate };
    }

    return { id: `ch_${this.slug}_ok_${suffix}`, status: "succeeded" };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error(`amountCents must be a positive integer number of cents, got ${input.amountCents}`);
    }

    // A card decline cannot fail a refund — money is going the other way — so the decline settings
    // deliberately do not apply here. A timeout still can: that is the network, not the card.
    if (this.simulate === "timeout") {
      throw new ProviderTimeoutError(this.code, "refund", input.idempotencyKey);
    }

    return { id: `re_${this.slug}_${stableHash(input.idempotencyKey)}`, status: "succeeded" };
  }

  async getCharge(chargeId: string): Promise<ChargeLookup> {
    if (this.simulate === "timeout") {
      throw new ProviderTimeoutError(this.code, "getCharge");
    }
    if (chargeId.startsWith(`ch_${this.slug}_ok_`)) return { status: "succeeded" };
    if (chargeId.startsWith(`ch_${this.slug}_dec_`)) return { status: "failed" };
    // An id from the other provider, or something we never issued.
    return { status: "unknown" };
  }
}

export class DummyStripeProvider extends DummyProvider {
  readonly code = "dummy_stripe" as const;
  protected readonly slug = "dstripe";
}

export class DummyPayPalProvider extends DummyProvider {
  readonly code = "dummy_paypal" as const;
  protected readonly slug = "dpaypal";
}
