// View types the extension and field-map APIs return, client-safe.

import type { FieldMapInputKind, FieldMapStatus, GrantStatus } from "./constants";

export type FieldMapEntryView = {
  id: string;
  /** The carrier page the field is on (`carrier_field_map_step.page_key`). */
  pageKey: string;
  fieldKey: string;
  selector: string;
  selectorFallback: string | null;
  inputKind: FieldMapInputKind;
  transform: string | null;
  optionMap: Record<string, string> | null;
  /** Share of fills that found the field, 0–1; null until the map has been used. */
  confidence: number | null;
  verified: boolean;
};

export type FieldMapStepView = { pageKey: string; urlPattern: string; sortOrder: number };

export type FieldMapMissView = { id: string; fieldKey: string; url: string; at: string };

export type FieldMapView = {
  id: string;
  carrierId: string;
  carrierName: string;
  productId: string | null;
  productLabel: string;
  version: number;
  status: FieldMapStatus;
  origin: string;
  /** A platform map (tenant_id null): read-only to an agency. */
  platform: boolean;
  /** 'ai' is the seam for decision 4; nothing writes it yet. */
  proposalSource: "manual" | "ai";
  steps: FieldMapStepView[];
  entries: FieldMapEntryView[];
  misses: FieldMapMissView[];
  updatedAt: string;
  approvedAt: string | null;
};

export type FieldMapCarrierOption = { id: string; name: string; portalOrigin: string | null; products: { id: string; name: string }[] };

export type GrantView = {
  id: string;
  applicationId: string;
  caseId: string | null;
  clientName: string;
  reference: string | null;
  carrierName: string;
  origin: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  fieldsRead: number;
  status: GrantStatus;
  /** Minted for the person looking. A producer may revoke only these. */
  mine: boolean;
};

export type CarrierSiteView = { carrierId: string; name: string; origin: string; fieldMap: "none" | "draft" | "published" | "needs_review" };

export type CopyTickView = { fieldKey: string; copiedAt: string; surface: "web" | "popout" | "extension" };
