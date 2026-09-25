export const PARTNER_CARD_TYPES = ["new_lead", "connected", "transferred", "call_dropped", "agent_ready", "call_outcome", "nobody_claimed"] as const;
export type PartnerCardType = (typeof PARTNER_CARD_TYPES)[number];

export type PartnerMessage = {
  id: string;
  channelId: string;
  partnerId: string | null;
  workItemId: string | null;
  message: string;
  messageKind: "text" | "system_card";
  cardType: PartnerCardType | null;
  cardPayload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  attachments: PartnerMessageAttachment[];
};

export type PartnerMessageAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string | null;
};

export function isPartnerCardType(value: unknown): value is PartnerCardType {
  return typeof value === "string" && (PARTNER_CARD_TYPES as readonly string[]).includes(value);
}

/** Parsers are deliberately tolerant: a future card is readable as its stored text. */
export function parsePartnerMessage(row: unknown): PartnerMessage | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.channel_id !== "string" || (value.partner_id !== null && typeof value.partner_id !== "string") || typeof value.message !== "string" || typeof value.created_at !== "string") return null;
  const payload = value.card_payload && typeof value.card_payload === "object" && !Array.isArray(value.card_payload) ? value.card_payload as Record<string, unknown> : {};
  const kind = value.message_kind === "system_card" && isPartnerCardType(value.card_type) ? "system_card" : "text";
  const attachments = Array.isArray(value.attachments) ? value.attachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return [];
    const item = attachment as Record<string, unknown>;
    const fileName = typeof item.file_name === "string" ? item.file_name : item.fileName;
    const contentType = typeof item.content_type === "string" ? item.content_type : item.contentType;
    const sizeBytes = typeof item.size_bytes === "number" ? item.size_bytes : item.sizeBytes;
    const downloadUrl = typeof item.download_url === "string" ? item.download_url : item.downloadUrl;
    if (typeof item.id !== "string" || typeof fileName !== "string" || typeof contentType !== "string" || typeof sizeBytes !== "number") return [];
    return [{ id: item.id, fileName, contentType, sizeBytes, downloadUrl: typeof downloadUrl === "string" ? downloadUrl : null } satisfies PartnerMessageAttachment];
  }) : [];
  return { id: value.id, channelId: value.channel_id, partnerId: value.partner_id, workItemId: typeof value.work_item_id === "string" ? value.work_item_id : null, message: value.message, messageKind: kind, cardType: kind === "system_card" ? value.card_type as PartnerCardType : null, cardPayload: payload, createdBy: typeof value.created_by === "string" ? value.created_by : null, createdAt: value.created_at, attachments };
}

export function cardTitle(message: PartnerMessage): string {
  if (message.messageKind !== "system_card" || !message.cardType) return "Message";
  return ({ new_lead: "New lead available", connected: "Connected", transferred: "Transferred", call_dropped: "Call dropped", agent_ready: "Agent ready", call_outcome: "Call outcome", nobody_claimed: "Nobody claimed" } satisfies Record<PartnerCardType, string>)[message.cardType];
}
