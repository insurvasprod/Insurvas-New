// Request schemas for the LA-3.12 / 3.13 / 3.14 API. Strict: an unknown key is a 400.

import { z } from "zod";

import { FIELD_MAP_INPUT_KINDS } from "./constants";

const uuid = z.string().uuid();
export const fieldKey = z.string().regex(/^[a-z]+\.[a-z0-9_]+$/, "Choose a valid field");
const https = z.string().trim().max(300).regex(/^https:\/\/[^\s/]+(\/\S*)?$/, "Enter the carrier portal address, starting https://.");

export const grantSchema = z.object({ application_id: uuid, carrier_id: uuid }).strict();

export const revokeSchema = z.object({ grant_id: uuid.optional() }).strict();

export const copyTickSchema = z.object({
  field_key: fieldKey.optional(),
  field_keys: z.array(fieldKey).min(1).max(100).optional(),
  surface: z.enum(["web", "popout"]).default("web"),
}).strict().refine((v) => Boolean(v.field_key) !== Boolean(v.field_keys), { message: "Send one field_key or a field_keys list." });

export const extensionTickSchema = z.object({ field_key: fieldKey }).strict();

export const mapMissSchema = z.object({
  map_id: uuid,
  page_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
  /** Origin + path of the carrier page. A query string is dropped server-side (it can carry PII). */
  url: z.string().max(500).optional(),
  misses: z.array(z.object({ field_key: fieldKey, reason: z.enum(["selector_not_found", "option_not_found", "not_fillable"]).default("selector_not_found") }).strict()).max(200).default([]),
  fields_filled: z.number().int().nonnegative().max(1000).optional(),
  fields_total: z.number().int().nonnegative().max(1000).optional(),
}).strict();

export const createMapSchema = z.object({
  carrier_id: uuid,
  carrier_product_id: uuid.nullish(),
  origin: https,
}).strict();

const pageKey = z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/, "A page key is lower case letters, digits and _");

export const saveMapSchema = z.object({
  status: z.enum(["draft", "in_review"]).optional(),
  origin: https.optional(),
  steps: z.array(z.object({ page_key: pageKey, url_pattern: z.string().trim().min(1).max(500), sort_order: z.number().int().min(0).max(1000) }).strict()).max(40).optional(),
  entries: z.array(z.object({
    page_key: pageKey,
    field_key: fieldKey,
    selector: z.string().trim().max(1000),
    selector_fallback: z.string().trim().max(1000).nullish(),
    input_kind: z.enum(FIELD_MAP_INPUT_KINDS),
    value_transform: z.string().trim().max(60).nullish(),
    option_map: z.record(z.string().max(100), z.string().max(200)).nullish(),
    verified: z.boolean(),
  }).strict()).max(300),
}).strict();

export type SaveMapInput = z.infer<typeof saveMapSchema>;
