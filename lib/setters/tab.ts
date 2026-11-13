export type SettersTab = "overview" | "setup";

/** The Appointments & setters tab named in the address (?tab=); anything else is the overview. */
export function parseSettersTab(value: string | undefined): SettersTab {
  return value === "setup" ? value : "overview";
}
