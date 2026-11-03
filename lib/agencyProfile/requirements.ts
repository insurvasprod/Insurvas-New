/**
 * LA-8.3 (Notion sprint) · what each document needs from the business identity.
 *
 * A document generated without these produces something that cannot be sent, so each one checks
 * first — and the prompt names the field and the document, never "complete your profile": a generic
 * prompt makes the owner guess which of twelve fields matters, and the usual outcome is none.
 *
 * Per document, so nothing demands a field it does not use (a welcome pack needs no NPN). The same
 * table is in SQL as business_identity_missing() (migration 20261015300000), which the payout publish
 * uses; lib/agencyProfile/businessIdentity.test.mjs asserts the two agree.
 *
 * Plain module: the settings form shows the same checklist the documents enforce.
 */

export type BusinessField = "trading_name" | "legal_name" | "npn" | "address" | "phone" | "tax_id";
export type BusinessDocument = "welcome_pack" | "payout_statement" | "dispute_letter" | "doi_response" | "tax_export";

export const BUSINESS_FIELD_LABELS: Record<BusinessField, string> = {
  trading_name: "trading name",
  legal_name: "legal name",
  npn: "NPN",
  address: "business address",
  phone: "business phone",
  tax_id: "tax ID",
};

/** The form field each requirement is fixed in — the anchor the prompt links to. */
export const BUSINESS_FIELD_ANCHORS: Record<BusinessField, string> = {
  trading_name: "identity-trading-name",
  legal_name: "identity-legal-name",
  npn: "identity-npn",
  address: "identity-address-line1",
  phone: "identity-phone",
  tax_id: "identity-tax-id",
};

export const DOCUMENT_REQUIREMENTS: Record<BusinessDocument, { label: string; module: string; fields: readonly BusinessField[]; why: string }> = {
  welcome_pack: { label: "welcome pack", module: "LA-3.20", fields: ["trading_name", "phone"], why: "Clients need to see who sent it and how to reach you." },
  payout_statement: { label: "payout statement", module: "LA-7.4", fields: ["trading_name", "address"], why: "Partner statements must show who they are from." },
  dispute_letter: { label: "commission dispute letter", module: "LA-4.15", fields: ["trading_name", "npn", "address"], why: "A carrier matches a dispute to the agency by its NPN and address." },
  doi_response: { label: "DOI complaint response", module: "LA-6.4", fields: ["legal_name", "npn"], why: "A regulator response must name the licensed entity." },
  tax_export: { label: "tax export", module: "LA-7.8", fields: ["legal_name", "tax_id"], why: "Tax forms are filed under the legal name and tax ID." },
};

export const BUSINESS_DOCUMENTS = Object.keys(DOCUMENT_REQUIREMENTS) as BusinessDocument[];

/** The parts of the identity the requirements read. */
export type IdentityFacts = {
  tradingName: string | null;
  legalName: string | null;
  npn: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  hasTaxId: boolean;
};

const has = (value: string | null | undefined) => Boolean(value && value.trim());

/** Complete enough to post a letter to: street, city, state and ZIP. */
export function addressComplete(facts: Pick<IdentityFacts, "addressLine1" | "city" | "state" | "postalCode">): boolean {
  return has(facts.addressLine1) && has(facts.city) && has(facts.state) && has(facts.postalCode);
}

function present(facts: IdentityFacts, field: BusinessField): boolean {
  switch (field) {
    case "trading_name": return has(facts.tradingName);
    case "legal_name": return has(facts.legalName);
    case "npn": return has(facts.npn);
    case "address": return addressComplete(facts);
    case "phone": return has(facts.phone);
    case "tax_id": return facts.hasTaxId;
  }
}

/** The fields this document is missing, in the order the prompt names them. Empty: it can be generated. */
export function missingFor(facts: IdentityFacts | null, document: BusinessDocument): BusinessField[] {
  return DOCUMENT_REQUIREMENTS[document].fields.filter((field) => !facts || !present(facts, field));
}

const joined = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/**
 * "Add your business address before generating a payout statement. Partner statements must show who
 * they are from." — the field and the document, both named.
 */
export function requirementMessage(document: BusinessDocument, missing: readonly BusinessField[]): string {
  const doc = DOCUMENT_REQUIREMENTS[document];
  const verb = document === "tax_export" ? "exporting your tax summary" : document === "doi_response" ? "preparing a DOI complaint response" : `generating a ${doc.label}`;
  return `Add your ${joined(missing.map((field) => BUSINESS_FIELD_LABELS[field]))} before ${verb}. ${doc.why}`;
}

/** The address as a document prints it: street lines, then "City, ST 12345". */
export function addressLinesOf(facts: { addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null }): string[] {
  const place = [facts.city?.trim(), [facts.state?.trim(), facts.postalCode?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [facts.addressLine1?.trim(), facts.addressLine2?.trim(), place].filter((line): line is string => Boolean(line));
}
