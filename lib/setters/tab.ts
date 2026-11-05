export type SettersTab = "overview" | "calendar" | "setup";

/** The Appointments & setters tab named in the address (?tab=); anything else is the overview. */
export function parseSettersTab(value: string | undefined): SettersTab {
  return value === "calendar" || value === "setup" ? value : "overview";
}
