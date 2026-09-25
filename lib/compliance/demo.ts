export type DemoScreeningVendorType = "dnc_scrub" | "litigator_scrub";

/**
 * The demo adapter is intentionally opt-in and local-only. It gives browser QA a
 * deterministic provider contract without turning an unconfigured production
 * environment into an allow path.
 */
export function demoScreeningEnabled() {
  const localApp = /^https?:\/\/localhost(?::\d+)?$/i.test(process.env.NEXT_PUBLIC_APP_URL ?? "");
  return process.env.DEMO_SCREENING_MODE === "true" && (process.env.NODE_ENV !== "production" || localApp);
}

export function demoScreeningVendor(vendorType: DemoScreeningVendorType) {
  return {
    id: `demo:${vendorType}`,
    endpoint: `demo://${vendorType}`,
    credentials: null,
    vendorType,
  };
}

/**
 * LA-2.3-7: numbers ending 0503 make the demo vendor fail as a real one does in an outage (no
 * answer), for both the DNC and the litigator feed. The fail-closed paths — import, campaign
 * re-scrub, a real-time post, the dial — can then be proven without breaking a shared server's
 * credentials. Only the demo adapter ever reaches this, and only with DEMO_SCREENING_MODE on.
 */
export const DEMO_OUTAGE_SUFFIX = "0503";

export class DemoVendorOutageError extends Error {
  constructor(vendorType: DemoScreeningVendorType) {
    super(`The demo ${vendorType === "litigator_scrub" ? "litigator" : "DNC"} feed did not answer (demo outage number)`);
    this.name = "DemoVendorOutageError";
  }
}

export function demoScreeningOutage(phoneDigits: string) {
  return phoneDigits.endsWith(DEMO_OUTAGE_SUFFIX);
}

export function demoScreeningListed(vendorType: DemoScreeningVendorType, phoneDigits: string) {
  // The outage number never gets an answer, listed or clear: the caller sees a vendor failure.
  if (demoScreeningOutage(phoneDigits)) throw new DemoVendorOutageError(vendorType);
  // Reserved 555 test numbers keep the scenarios obvious and non-real.
  return vendorType === "litigator_scrub" ? phoneDigits.endsWith("0001") : phoneDigits.endsWith("0101");
}

export function demoScreeningResponse(vendorType: DemoScreeningVendorType, listed: boolean): Record<string, boolean> {
  return vendorType === "litigator_scrub"
    ? { demo: true, hit: listed }
    : { demo: true, listed };
}

export function demoDncAllowed(phoneDigits: string) {
  return !demoScreeningListed("dnc_scrub", phoneDigits);
}
