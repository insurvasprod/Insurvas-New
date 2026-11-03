// LA-3.6 / 3.17 / 3.25 · Zod for the agency's carrier facts and carrier products. Client-safe.
// Money is integer cents; the per-$1,000 band is dollars (numeric(6,2)) and travels as a string so it
// never passes through a float.

import { z } from "zod";

import { FE_TIERS, PAYMENT_METHODS } from "../applications/constants.ts";
import { idSchema } from "./templateSchemas.ts";

export const HTTPS_ORIGIN = /^https:\/\/[^/\s]+$/;

/** "agents.carrier.com/login" → "https://agents.carrier.com" (null when it cannot be an origin). */
export function toHttpsOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" && url.host ? `https://${url.host}` : null;
  } catch {
    return null;
  }
}

/** A full https URL, scheme added when it was left off; null when it is not one. */
export function toHttpsUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || !url.host) return null;
    return url.pathname === "/" && !url.search && !url.hash ? url.href.slice(0, -1) : url.href;
  } catch {
    return null;
  }
}

export function patternProblem(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch {
    return "This is not a valid pattern.";
  }
}

const origin = z.string().trim().regex(HTTPS_ORIGIN, "Use the portal's https address, like https://agents.carrier.com");
const pattern = z.string().trim().min(1).max(200).refine((p) => patternProblem(p) === null, "This is not a valid pattern");
const descriptor = z.string().trim().min(1).max(60, "A billing descriptor is at most 60 characters");

/** The agency's own values; null means "use the platform library's". */
export const carrierFactsSchema = z.object({
  portal_origin: origin.nullable(),
  reference_pattern: pattern.nullable(),
  billing_descriptor: descriptor.nullable(),
}).strict();

export const addCarrierSchema = z.object({
  carrier_id: idSchema,
  portal_origin: origin.nullable().default(null),
  reference_pattern: pattern.nullable().default(null),
  billing_descriptor: descriptor.nullable().default(null),
}).strict();

const band = z.string().trim().regex(/^\d{1,4}(\.\d{1,2})?$/, "Write the band as dollars, like 2.10");
const cents = z.number().int().min(0).max(100_000_000_00);
const age = z.number().int().min(0).max(120);

const productFields = {
  product_code: z.string().trim().min(2).max(60).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1, "Give the product a name").max(160),
  tiers: z.array(z.enum(FE_TIERS)).max(FE_TIERS.length).default([]),
  issue_age_min: age.nullable(),
  issue_age_max: age.nullable(),
  face_min_cents: cents.nullable(),
  face_max_cents: cents.nullable(),
  band_min: band.nullable(),
  band_max: band.nullable(),
  accepted_payment_methods: z.array(z.enum(PAYMENT_METHODS)).max(PAYMENT_METHODS.length).default([]),
  is_active: z.boolean().default(true),
  // Term life (LA-3.25). Null on a final expense product.
  term_lengths: z.array(z.number().int().min(1).max(40)).min(1, "Add at least one term length").max(12).nullable().default(null),
  health_classes: z.array(z.string().trim().min(1).max(60)).min(1, "Add at least one health class").max(12).nullable().default(null),
  exam_required_above_face_cents: cents.nullable().default(null),
  convertible: z.boolean().nullable().default(null),
  conversion_deadline_rule: z.string().trim().max(200).nullable().default(null),
  renewal_type: z.enum(["annual_renewable", "level"]).nullable().default(null),
};

type ProductInput = { [K in keyof typeof productFields]: z.infer<(typeof productFields)[K]> };

function checkProduct(p: ProductInput, ctx: z.RefinementCtx) {
  if (p.issue_age_min !== null && p.issue_age_max !== null && p.issue_age_min > p.issue_age_max) ctx.addIssue({ code: "custom", path: ["issue_age_min"], message: "The lower issue age is above the upper one" });
  if (p.face_min_cents !== null && p.face_max_cents !== null && p.face_min_cents > p.face_max_cents) ctx.addIssue({ code: "custom", path: ["face_min_cents"], message: "The smallest face amount is above the largest" });
  if (p.band_min !== null && p.band_max !== null && Number(p.band_min) >= Number(p.band_max)) ctx.addIssue({ code: "custom", path: ["band_min"], message: "The low end of the band must be below the high end" });
  if (p.product_code !== "term_life") {
    const termOnly = [p.term_lengths, p.health_classes, p.exam_required_above_face_cents, p.convertible, p.conversion_deadline_rule, p.renewal_type].some((v) => v !== null);
    if (termOnly) ctx.addIssue({ code: "custom", path: ["product_code"], message: "Term lengths, health classes and exam limits apply to term life products only" });
  } else if (p.tiers.length) {
    ctx.addIssue({ code: "custom", path: ["tiers"], message: "Tiers are for final expense products; a term product uses health classes" });
  }
}

export const createProductSchema = z.object({ carrier_id: idSchema, ...productFields }).strict().superRefine(checkProduct);
export const updateProductSchema = z.object(productFields).strict().superRefine(checkProduct);

export type ProductBody = z.infer<typeof updateProductSchema>;
