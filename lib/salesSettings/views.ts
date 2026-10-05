// LA-3.17 · what the Settings › Sales routes send the panels. Types only, client-safe.

import type { PaymentMethod } from "../applications/constants.ts";
import type { StoredDefinition } from "../applications/templates.ts";
import type { SalesTemplateKind, SalesTemplateStatus } from "./templateSchemas.ts";

/** A portal account older than this since it was last known to work gets a nudge (LA-3.22). */
export const PORTAL_VERIFY_NUDGE_DAYS = 90;

export type TemplateRowView = {
  id: string;
  /** False for an Insurvas platform default: read-only until copied. */
  tenantOwned: boolean;
  kind: SalesTemplateKind;
  productCode: string;
  productName: string;
  carrierId: string | null;
  carrierName: string | null;
  name: string;
  version: number;
  status: SalesTemplateStatus;
  definition: StoredDefinition;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  editedBy: string | null;
};

export type NamedCarrier = { id: string; name: string };
export type ProductLine = { code: string; name: string };

export type TemplatesPayload = {
  templates: TemplateRowView[];
  /** The agency's carriers (Settings › Sales › Carriers and products), for pairs and duplicates. */
  carriers: NamedCarrier[];
  /** Each listed carrier's product names by product line, for the Product column. */
  carrierProducts: { carrierId: string; productCode: string; name: string }[];
  productLines: ProductLine[];
  canEdit: boolean;
};

export type CarrierFacts = { portalOrigin: string | null; referencePattern: string | null; billingDescriptor: string | null };

export type CarrierProductView = {
  id: string;
  carrierId: string;
  /** False for a platform row: read-only until copied to the agency. */
  tenantOwned: boolean;
  copiedFromId: string | null;
  productCode: string;
  name: string;
  tiers: string[];
  issueAgeMin: number | null;
  issueAgeMax: number | null;
  faceMinCents: number | null;
  faceMaxCents: number | null;
  /** Dollars per $1,000 of face, as stored (numeric(6,2)) — a plausibility band, not money. */
  bandMin: string | null;
  bandMax: string | null;
  acceptedPaymentMethods: PaymentMethod[];
  isActive: boolean;
  termLengths: number[] | null;
  healthClasses: string[] | null;
  examAboveFaceCents: number | null;
  convertible: boolean | null;
  conversionDeadlineRule: string | null;
  renewalType: "annual_renewable" | "level" | null;
};

export type PortalAccountView = {
  id: string;
  carrierId: string;
  portalUrl: string;
  username: string | null;
  writingNumber: string | null;
  mfaType: "none" | "sms" | "app" | "email";
  notes: string | null;
  lastVerifiedAt: string | null;
  /** Never verified, or verified more than PORTAL_VERIFY_NUDGE_DAYS ago. */
  needsCheck: boolean;
};

export type FieldMapChip = { status: "none" | "draft" | "published" | "needs_review"; version: number | null };

export type SalesCarrierView = {
  id: string;
  name: string;
  platform: CarrierFacts;
  override: CarrierFacts | null;
  /** The agency's value where it set one, else the platform's — what every feature reads. */
  effective: CarrierFacts;
  appointment: { activeStates: string[]; pendingStates: string[] };
  products: CarrierProductView[];
  fieldSet: "tenant" | "tenant_draft" | "platform";
  fieldMap: FieldMapChip;
  portal: PortalAccountView | null;
};

export type CarriersPayload = {
  carriers: SalesCarrierView[];
  /** Platform carriers not on the agency's list yet. */
  addable: NamedCarrier[];
  productLines: ProductLine[];
  canEdit: boolean;
};
