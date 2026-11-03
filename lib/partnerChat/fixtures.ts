import type { PartnerMessage, PartnerMessageAttachment } from "@/lib/partnerChat/cards";
import type { SupportContact } from "@/lib/partnerSupport/contact";

/**
 * Sample conversations for `/design/messages`.
 *
 * The development database holds one channel with three automatic updates and no reply, so the
 * thread cannot be seen there doing the things it was rebuilt to do: two sides, a run of messages
 * under one name, a day separator, an attachment inside a bubble, an empty conversation. These
 * fixtures are the only place those states exist. Development only — nothing imports this from a
 * page a partner can reach.
 */

export const SAMPLE_CHAT_STATES = ["busy", "quiet", "empty"] as const;
export type SampleChatState = (typeof SAMPLE_CHAT_STATES)[number];

/** Who the preview is signed in as. The thread draws these messages on the sent side. */
export const SAMPLE_VIEWER_ID = "00000000-0000-4000-8000-000000000001";
const COLLEAGUE = "00000000-0000-4000-8000-000000000002";
const AGENT = "00000000-0000-4000-8000-000000000003";

/** Ages run backwards from the moment the page is opened, so "Today" really is today. */
export const sampleChatNow = () => Date.now();

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

type Draft = {
  /** Milliseconds before `now`. */
  ago: number;
  by: string | null;
  text: string;
  card?: Record<string, unknown>;
  files?: Array<Pick<PartnerMessageAttachment, "fileName" | "contentType" | "sizeBytes">>;
};

function message(draft: Draft, now: number, index: number, channelId: string): PartnerMessage {
  return {
    id: `${channelId}-m${index}`,
    channelId,
    partnerId: "00000000-0000-4000-8000-0000000000p1",
    workItemId: draft.card ? `00000000-0000-4000-8000-00000000l${index}` : null,
    message: draft.text,
    messageKind: draft.card ? "system_card" : "text",
    cardType: draft.card ? "new_lead" : null,
    cardPayload: draft.card ?? {},
    createdBy: draft.by,
    createdAt: new Date(now - draft.ago).toISOString(),
    attachments: (draft.files ?? []).map((file, fileIndex) => ({
      id: `${channelId}-m${index}-f${fileIndex}`,
      ...file,
      // A preview never links to a real object; the bubble still draws the row.
      downloadUrl: null,
    })),
  };
}

/** The agent channel: three days, both sides, a run, an automatic update, an attachment. */
const AGENT_CHANNEL: Draft[] = [
  { ago: 2 * DAY + 5 * 60 * MINUTE, by: AGENT, text: "Morning — we picked up the four transfers you sent on Friday." },
  { ago: 2 * DAY + 4 * 60 * MINUTE + 58 * MINUTE, by: AGENT, text: "Two are already with an underwriter." },
  { ago: 2 * DAY + 4 * 60 * MINUTE, by: SAMPLE_VIEWER_ID, text: "Good to hear. Anything you need from our side?" },
  { ago: 1 * DAY + 7 * 60 * MINUTE, by: null, text: "Marcus Webb is available for Final Expense", card: { customer: "Marcus Webb", product: "final_expense", state: "GA", counts_as_work_completed: true, minutes_after_submission: 2 } },
  { ago: 1 * DAY + 6 * 60 * MINUTE, by: SAMPLE_VIEWER_ID, text: "Here is the call recording consent he signed.", files: [{ fileName: "webb-consent.pdf", contentType: "application/pdf", sizeBytes: 182_400 }] },
  { ago: 1 * DAY + 5 * 60 * MINUTE, by: AGENT, text: "Got it, thank you. Filed against the lead." },
  { ago: 4 * 60 * MINUTE, by: AGENT, text: "Quick update on today's batch." },
  { ago: 4 * 60 * MINUTE - 2 * MINUTE, by: AGENT, text: "Six of the nine are claimed, three are on a call right now." },
  { ago: 4 * 60 * MINUTE - 3 * MINUTE, by: AGENT, text: "Nothing has gone past the response window." },
  { ago: 3 * 60 * MINUTE, by: SAMPLE_VIEWER_ID, text: "Perfect." },
  { ago: 3 * 60 * MINUTE - MINUTE, by: SAMPLE_VIEWER_ID, text: "We are sending another dozen this afternoon." },
  { ago: 90 * MINUTE, by: null, text: "Dana Ruiz is connected to the agent", card: { customer: "Dana Ruiz", product: "final_expense", state: "TX", counts_as_work_completed: true, minutes_after_submission: 0 } },
  { ago: 25 * MINUTE, by: AGENT, text: "Dana converted. Nice lead." },
];

/** A partner team channel: colleagues, no automatic updates. */
const TEAM_CHANNEL: Draft[] = [
  { ago: 1 * DAY + 2 * 60 * MINUTE, by: COLLEAGUE, text: "I have the Tuesday batch ready to upload." },
  { ago: 1 * DAY + 60 * MINUTE, by: SAMPLE_VIEWER_ID, text: "Send it over when you are happy with it." },
  { ago: 40 * MINUTE, by: COLLEAGUE, text: "Uploaded — 48 rows, all with a signed consent.", files: [{ fileName: "tuesday-batch.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 64_900 }] },
];

type SampleChannel = {
  id: string;
  name: string;
  channel_type: "partner" | "direct" | "group";
  partner_id: string | null;
  status: string;
  unreadCount: number;
  messages: PartnerMessage[];
  realtimeTopic: string;
};

function channel(id: string, name: string, type: SampleChannel["channel_type"], drafts: Draft[], now: number, unread = 0): SampleChannel {
  return {
    id,
    name,
    channel_type: type,
    partner_id: type === "partner" ? "00000000-0000-4000-8000-0000000000p1" : null,
    status: "active",
    unreadCount: unread,
    messages: drafts.map((draft, index) => message(draft, now, index, id)),
    realtimeTopic: `partner-chat:${id}`,
  };
}

export type PartnerChatSampleData = {
  viewerId: string;
  channels: SampleChannel[];
  directory: Array<{ id: string; name: string; email: string; label: string; scope: "agent" | "partner"; role?: string; partnerName?: string }>;
  agencyName: string | null;
  agencySupport: SupportContact | null;
};

export function sampleChat(state: SampleChatState = "busy"): PartnerChatSampleData {
  const now = sampleChatNow();
  const directory = [
    { id: AGENT, name: "Priya Raman", email: "priya@example-agency.test", label: "Priya Raman · Licensed agent", scope: "agent" as const, role: "producer" },
    { id: SAMPLE_VIEWER_ID, name: "Rion Recica", email: "rion@example-partner.test", label: "Rion Recica · Partner team", scope: "partner" as const, role: "partner_admin", partnerName: "Sample Publishing Co." },
    { id: COLLEAGUE, name: "Dana Whitfield", email: "dana@example-partner.test", label: "Dana Whitfield · Partner team", scope: "partner" as const, role: "partner_user", partnerName: "Sample Publishing Co." },
  ];
  const agency = { agencyName: "Northstar Insurance Group", agencySupport: { email: "support@example-agency.test", phone: "+14725551313", schemaReady: true } satisfies SupportContact };

  if (state === "empty") {
    return { viewerId: SAMPLE_VIEWER_ID, channels: [channel("c-agent", "Northstar Insurance Group", "partner", [], now)], directory, ...agency };
  }
  if (state === "quiet") {
    return {
      viewerId: SAMPLE_VIEWER_ID,
      channels: [channel("c-agent", "Northstar Insurance Group", "partner", AGENT_CHANNEL.slice(-2), now)],
      directory,
      ...agency,
    };
  }
  return {
    viewerId: SAMPLE_VIEWER_ID,
    channels: [
      channel("c-agent", "Northstar Insurance Group", "partner", AGENT_CHANNEL, now, 2),
      channel("c-team", "Partner operations", "group", TEAM_CHANNEL, now),
      channel("c-dana", "Dana Whitfield", "direct", [], now),
    ],
    directory,
    ...agency,
  };
}
