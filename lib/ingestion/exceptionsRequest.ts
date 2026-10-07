/**
 * LA-4.9 (Notion sprint) · the request shapes /api/app/exceptions accepts: resolve an item (one shape
 * per resolution, each with what it needs) or set who owns a queue. Kept apart from the route so
 * exceptionQueues.test.mjs parses every shape.
 *
 * Relative imports only.
 */
import { z } from "zod";

import { OWNER_ROLES, QUEUE_TYPES } from "./exceptionQueues.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID, "Choose a record.");

const resolve = z.discriminatedUnion("resolution", [
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("confirm_client") }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("not_mine") }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("same_person") }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("different_people") }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("link_existing_client"), contact_id: uuid }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("found_the_sale"), deal_id: uuid }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("found_the_policy"), carrier_id: uuid, policy_number: z.string().trim().min(1).max(120) }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("never_submitted"), reason: z.string().trim().min(1, "Say why it was never submitted.").max(2000) }).strict(),
  z.object({ action: z.literal("resolve"), item_id: uuid, resolution: z.literal("resubmitted_elsewhere"), application_id: uuid }).strict(),
]);

const saveRule = z.object({
  action: z.literal("save_rule"),
  queue_type: z.enum(QUEUE_TYPES),
  owner_role: z.enum(OWNER_ROLES),
  open_after_days: z.number().int().min(1).max(120).nullable(),
  escalate_after_days: z.number().int().min(1).max(365).nullable(),
  escalate_to_role: z.enum(OWNER_ROLES).nullable(),
}).strict();

export const exceptionsRequest = z.union([resolve, saveRule]);
export type ExceptionsRequest = z.infer<typeof exceptionsRequest>;
