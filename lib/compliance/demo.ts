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

export function demoScreeningListed(vendorType: DemoScreeningVendorType, phoneDigits: string) {
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
