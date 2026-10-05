// Request schemas for the after-submit API (LA-3.15 confirmation, 3.18 requirements, 3.20 welcome
// pack, 3.24 household, 3.26 counteroffers). Strict, like lib/applications/schemas.ts: an unknown
// key is a 400.

import { z } from "zod";

import { FE_TIERS, REQUIREMENT_KINDS, WAITING_ON } from "./constants";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const cents = z.number().int().positive().max(1_000_000_000_00);

const examFields = {
  exam_vendor: z.string().trim().min(1).max(120).nullish(),
  exam_ordered_on: isoDate.nullish(),
  exam_scheduled_on: isoDate.nullish(),
  exam_completed_on: isoDate.nullish(),
  exam_results_on: isoDate.nullish(),
};

/** The kinds an agent raises by hand; a counteroffer requirement comes only from recording one. */
const MANUAL_KINDS = REQUIREMENT_KINDS.filter((k) => k !== "counteroffer") as [Exclude<(typeof REQUIREMENT_KINDS)[number], "counteroffer">, ...Exclude<(typeof REQUIREMENT_KINDS)[number], "counteroffer">[]];

export const addRequirementSchema = z.object({
  kind: z.enum(MANUAL_KINDS),
  description: z.string().trim().min(1, "Say what the carrier asked for.").max(1000),
  waiting_on: z.enum(WAITING_ON),
  raised_at: isoDate.nullish(),
  due_at: isoDate.nullish(),
  note: z.string().max(2000).nullish(),
  ...examFields,
}).strict();

export const updateRequirementSchema = z.object({
  status: z.enum(["open", "in_progress", "satisfied", "waived", "expired"]).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  waiting_on: z.enum(WAITING_ON).optional(),
  due_at: isoDate.nullish(),
  note: z.string().max(2000).nullish(),
  ...examFields,
}).strict();

export const requirementCallbackSchema = z.object({
  /** Local wall-clock time in the customer's timezone, `YYYY-MM-DDTHH:mm`. */
  local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time"),
  timezone: z.string().trim().min(1).max(100).nullish(),
  note: z.string().max(1000).nullish(),
}).strict();

export const recordCounterofferSchema = z.object({
  offered_tier: z.enum(FE_TIERS).nullish(),
  offered_health_class: z.string().trim().min(1).max(60).nullish(),
  offered_face_cents: cents,
  offered_monthly_premium_cents: cents,
  offered_annual_premium_cents: cents.nullish(),
  reason_text: z.string().trim().min(1, "Say why — it's what you'll tell the client.").max(2000),
  expires_at: z.string().datetime({ offset: true }),
  received_at: z.string().datetime({ offset: true }).nullish(),
  applied_effective_on: isoDate.nullish(),
  offered_effective_on: isoDate.nullish(),
}).strict();

export const respondCounterofferSchema = z.object({
  response: z.enum(["accept", "reject", "expire"]),
  note: z.string().max(2000).nullish(),
}).strict();

export const welcomePackSchema = z.object({
  /**
   * "submit": what submitting does — the PDF, then the email if the agency's auto-send is on.
   * "generate": the PDF only. "send": the agent sends it now (once per attempt).
   * "reissue": the agent sends the updated pack after an accepted counteroffer.
   */
  action: z.enum(["submit", "generate", "send", "reissue"]).default("submit"),
}).strict();

export const addSpouseSchema = z.object({
  first_name: z.string().trim().min(1, "Enter the spouse's name.").max(80),
  last_name: z.string().trim().min(1, "Enter the spouse's name.").max(80),
  dob: isoDate.nullish(),
  gender: z.enum(["female", "male"]).nullish(),
  share_address: z.boolean().default(true),
  share_contact: z.boolean().default(true),
  share_payment: z.boolean().default(true),
  share_draft_day: z.boolean().default(true),
}).strict();

export const detachSchema = z.object({
  /** A household value key (addr.* / contact.*), or "payment", or "draft_day". */
  field_key: z.union([z.string().regex(/^(addr|contact)\.[a-z0-9_]+$/), z.literal("payment"), z.literal("draft_day")]),
}).strict();

export const referenceCheckQuery = z.object({ reference: z.string().trim().min(1).max(120) }).strict();
