import { z } from "zod";

import { WEBHOOK_EVENT_KEYS, type WebhookEventType } from "@/lib/apiKeys/constants";

/** What the settings screen and `POST /api/v1/webhooks` both accept. The URL is checked again by `checkTargetUrl`. */
export const webhookInputSchema = z.object({
  label: z.string().trim().min(1, "Name the webhook").max(80),
  targetUrl: z.string().trim().min(1, "Enter the URL to send to").max(500).refine((value) => value.toLowerCase().startsWith("https://"), "Webhook URLs must use HTTPS."),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_KEYS as [WebhookEventType, ...WebhookEventType[]])).min(1, "Choose at least one event").max(WEBHOOK_EVENT_KEYS.length),
}).strict();
