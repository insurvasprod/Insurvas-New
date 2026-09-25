// The grid uses the USPS abbreviations because appointments, licences and CE records all use
// the same two-letter state key.
export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
] as const;

export const STATE_CODES = US_STATES.map(([code]) => code);
export type StateCode = (typeof US_STATES)[number][0];

/**
 * The four US Census regions, each listed division by division. The carrier-appointments table
 * orders its state columns by this, so "grouped by region" on that table is literally true.
 */
export const US_REGIONS = [
  { name: "Northeast", states: ["CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA"] },
  { name: "Midwest", states: ["IL", "IN", "MI", "OH", "WI", "IA", "KS", "MN", "MO", "NE", "ND", "SD"] },
  { name: "South", states: ["DE", "DC", "FL", "GA", "MD", "NC", "SC", "VA", "WV", "AL", "KY", "MS", "TN", "AR", "LA", "OK", "TX"] },
  { name: "West", states: ["AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY", "AK", "CA", "HI", "OR", "WA"] },
] as const satisfies ReadonlyArray<{ name: string; states: readonly StateCode[] }>;
export type UsRegion = (typeof US_REGIONS)[number]["name"];

const REGION_ORDER = new Map<string, { region: UsRegion; order: number }>(
  US_REGIONS.flatMap((region, regionIndex) =>
    region.states.map((state, index) => [state, { region: region.name, order: regionIndex * 100 + index }] as const),
  ),
);

/** The Census region a state belongs to, or null for a code outside the 50 states and DC. */
export function regionOf(state: string): UsRegion | null {
  return REGION_ORDER.get(state)?.region ?? null;
}

/** Region first, then division order inside it; unknown codes go last, alphabetically. */
export function compareByRegion(a: string, b: string): number {
  const left = REGION_ORDER.get(a)?.order ?? 10_000;
  const right = REGION_ORDER.get(b)?.order ?? 10_000;
  return left - right || a.localeCompare(b);
}
