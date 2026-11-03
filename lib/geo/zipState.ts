// Client-safe. The US state a ZIP code belongs to, from its first three digits (the USPS sectional
// centre ranges). Used by the affiliate intake form, which asks a consumer for a ZIP rather than a
// state and still needs the state for calling-window rules. Territories and military prefixes
// return null, and the form then asks for the state directly.

/** [first prefix, last prefix, state] — inclusive ranges, in order. */
const RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [5, 5, "NY"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"],
  [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 200, "DC"], [201, 201, "VA"],
  [202, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"],
  [290, 299, "SC"], [300, 319, "GA"], [320, 339, "FL"], [341, 349, "FL"], [350, 369, "AL"],
  [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"],
  [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"],
  [569, 569, "DC"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"],
  [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"],
  [730, 732, "OK"], [733, 733, "TX"], [734, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"],
  [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"],
  [885, 885, "TX"], [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"],
  [980, 994, "WA"], [995, 999, "AK"],
];

/** Five digits, or ZIP+4. Anything else is not a ZIP. */
export function normalizeZip(raw: string): string | null {
  const match = /^\s*(\d{5})(?:-?\d{4})?\s*$/.exec(raw);
  return match ? match[1] : null;
}

/** The two-letter state for a ZIP, or null when the prefix is a territory, military or unassigned. */
export function stateForZip(raw: string): string | null {
  const zip = normalizeZip(raw);
  if (!zip) return null;
  const prefix = Number(zip.slice(0, 3));
  for (const [from, to, state] of RANGES) {
    if (prefix >= from && prefix <= to) return state;
  }
  return null;
}
