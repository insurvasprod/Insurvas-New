// The admin dashboard's period switch (admin round 1: "30 days · 90 days · 12 months"). Its own module, with
// no imports, so the client switch carries nothing else into the browser; lib/adminDashboard/series.ts
// re-exports it for the server side and the tests.

export const DASH_PERIODS = ["30d", "90d", "12m"] as const;
export type DashPeriod = (typeof DASH_PERIODS)[number];

export const DASH_PERIOD_LABELS: Record<DashPeriod, string> = { "30d": "30 days", "90d": "90 days", "12m": "12 months" };

/** The address's `?period=` when it is one of `allowed`, else `fallback`. */
export function pickDashPeriod<P extends DashPeriod>(raw: string | null | undefined, allowed: readonly P[], fallback: P): P {
  return allowed.find((period) => period === raw) ?? fallback;
}
