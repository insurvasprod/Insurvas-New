export const PRODUCT_OPTIONS = [
  { value: "life", label: "Life insurance" },
  { value: "health", label: "Health insurance" },
  { value: "medicare", label: "Medicare" },
  { value: "annuities", label: "Annuities" },
  { value: "property_casualty", label: "Property & casualty" },
  { value: "supplemental", label: "Supplemental benefits" },
] as const;

export const VOLUME_OPTIONS = [
  { value: "0_25", label: "0–25 applications / month" },
  { value: "26_100", label: "26–100 applications / month" },
  { value: "101_250", label: "101–250 applications / month" },
  { value: "251_500", label: "251–500 applications / month" },
  { value: "500_plus", label: "500+ applications / month" },
] as const;

export const LEAD_SOURCE_OPTIONS = [
  { value: "referrals", label: "Referrals" },
  { value: "purchased", label: "Purchased leads" },
  { value: "website", label: "Website / inbound" },
  { value: "social", label: "Social media" },
  { value: "networking", label: "Networking" },
  { value: "existing_book", label: "Existing book of business" },
  { value: "other", label: "Other" },
] as const;

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"], ["DC", "District of Columbia"],
] as const;

export type SetupProfileInput = {
  productsSold: string[];
  monthlyVolumeRange: string;
  leadSources: string[];
};

export function deriveRecommendedSetupSteps(profile: SetupProfileInput): string[] {
  const steps = ["Configure your product workspace"];

  if (profile.leadSources.some((source) => ["purchased", "website", "social"].includes(source))) {
    steps.push("Connect and route your lead sources");
  }
  if (profile.leadSources.includes("existing_book")) {
    steps.push("Import your existing book of business");
  }
  if (["101_250", "251_500", "500_plus"].includes(profile.monthlyVolumeRange)) {
    steps.push("Configure high-volume workflow automation");
  }
  if (profile.productsSold.includes("medicare")) {
    steps.push("Set up Medicare compliance preferences");
  }

  return steps;
}
