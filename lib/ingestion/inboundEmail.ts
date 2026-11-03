/**
 * LA-4.1 (Notion sprint) · the email door: an agency forwards (or has its carriers send) statements
 * to its own address, and each attachment becomes a registered file.
 *
 * The provider is Postmark inbound (owner decision 2026-10-07). Postmark posts the whole message as
 * JSON with attachments inlined in base64; this module reads that payload and decides, for each
 * attachment, the agency, carrier, file type and date — without opening the attachment.
 *
 *   · The agency: the token in the address it was sent to — "<token>@<inbound domain>", or Postmark's
 *     own "<server>+<token>@inbound.postmarkapp.com" (its MailboxHash).
 *   · The carrier: the sender, matched EXACTLY against the agency's (then the platform's) known
 *     senders — an address, or a whole "@domain". Failing that, a carrier the file name or subject
 *     names unambiguously. Failing that, the file is registered as failed and says why.
 *   · The type and date: the file name, then the subject; the date falls back to the day the email
 *     was sent — never anything inside the file.
 *
 * Pure; relative imports only.
 */
import { carrierFileKind, type CarrierFileType } from "./constants.ts";
import { prefillFromFilename, type Attribution, type CarrierChoice } from "./path.ts";

export const INBOUND_TOKEN = /^[a-z0-9]{20,40}$/;

type PostmarkAddress = { Email?: string; Name?: string; MailboxHash?: string };
type PostmarkAttachment = { Name?: string; Content?: string; ContentType?: string; ContentLength?: number };

export type PostmarkInbound = {
  From?: string;
  FromFull?: PostmarkAddress;
  ToFull?: PostmarkAddress[];
  CcFull?: PostmarkAddress[];
  BccFull?: PostmarkAddress[];
  OriginalRecipient?: string;
  MailboxHash?: string;
  Subject?: string;
  MessageID?: string;
  Date?: string;
  Attachments?: PostmarkAttachment[];
};

export type InboundAttachment = { name: string; contentType: string | null; bytes: Uint8Array };

export type InboundMessage = {
  tokens: string[];
  from: string | null;
  subject: string;
  messageId: string | null;
  sentOn: string | null;
  attachments: InboundAttachment[];
};

function localPart(address: string | undefined): string | null {
  const at = (address ?? "").lastIndexOf("@");
  if (at <= 0) return null;
  const local = address!.slice(0, at).toLowerCase();
  const plus = local.indexOf("+");
  return plus >= 0 ? local.slice(plus + 1) : local;
}

function base64Bytes(content: string): Uint8Array {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The YYYY-MM-DD an RFC 2822 "Date" header names, in UTC; null when it does not parse. */
export function sentOnFrom(header: string | undefined): string | null {
  if (!header) return null;
  const time = Date.parse(header);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/** Reads Postmark's payload. Only CSV, Excel and PDF attachments are kept; a signature image is not a statement. */
export function readPostmarkInbound(payload: PostmarkInbound): InboundMessage {
  const recipients = [...(payload.ToFull ?? []), ...(payload.CcFull ?? []), ...(payload.BccFull ?? [])];
  const candidates = [
    payload.MailboxHash,
    ...recipients.map((recipient) => recipient.MailboxHash),
    ...recipients.map((recipient) => localPart(recipient.Email) ?? undefined),
    localPart(payload.OriginalRecipient) ?? undefined,
  ];
  const tokens = [...new Set(candidates.map((value) => (value ?? "").trim().toLowerCase()).filter((value) => INBOUND_TOKEN.test(value)))];
  const attachments: InboundAttachment[] = [];
  for (const attachment of payload.Attachments ?? []) {
    const name = (attachment.Name ?? "").trim();
    if (!name || !attachment.Content) continue;
    if (!carrierFileKind({ name, type: attachment.ContentType })) continue;
    attachments.push({ name, contentType: attachment.ContentType ?? null, bytes: base64Bytes(attachment.Content) });
  }
  const from = (payload.FromFull?.Email ?? payload.From ?? "").trim().toLowerCase() || null;
  return { tokens, from, subject: (payload.Subject ?? "").trim(), messageId: payload.MessageID ?? null, sentOn: sentOnFrom(payload.Date), attachments };
}

export type KnownSender = { carrierId: string; sender: string; tenantId: string | null };

/**
 * The carrier a sender is known to be, exact match only: the address, then its "@domain"; the
 * agency's own senders before the platform's. Never fuzzy.
 */
export function carrierForSender(from: string | null, senders: KnownSender[]): string | null {
  if (!from || !from.includes("@")) return null;
  const domain = from.slice(from.lastIndexOf("@"));
  for (const scope of [(row: KnownSender) => row.tenantId !== null, (row: KnownSender) => row.tenantId === null]) {
    const exact = senders.find((row) => scope(row) && row.sender === from);
    if (exact) return exact.carrierId;
    const whole = senders.find((row) => scope(row) && row.sender === domain);
    if (whole) return whole.carrierId;
  }
  return null;
}

export type EmailAttribution = { carrierId: string | null; attribution: Attribution; problems: string[] };

/** What one attachment is, from the sender, its name and the subject. */
export function attributeAttachment(
  message: Pick<InboundMessage, "from" | "subject" | "sentOn">,
  filename: string,
  senders: KnownSender[],
  carriers: CarrierChoice[],
): EmailAttribution {
  const byName = prefillFromFilename(filename, carriers);
  const bySubject = prefillFromFilename(message.subject, carriers);
  const carrierId = carrierForSender(message.from, senders) ?? byName.carrierId ?? bySubject.carrierId;
  const fileType: CarrierFileType | null = byName.fileType ?? bySubject.fileType;
  const fileDate = byName.fileDate ?? bySubject.fileDate ?? message.sentOn;
  const carrier = carriers.find((choice) => choice.id === carrierId) ?? null;
  const problems: string[] = [];
  if (!carrier) problems.push(`We couldn't tell which carrier sent this${message.from ? ` (from ${message.from})` : ""}. Add the sender as a known carrier sender, or upload the file instead.`);
  if (!fileType) problems.push("We couldn't tell whether this is a policy file or a commission file from its name or the subject.");
  if (!fileDate) problems.push("We couldn't tell the file's date.");
  return {
    carrierId: carrier?.id ?? null,
    attribution: { fileDate, agency: null, carrierCode: carrier?.code ?? null, fileType },
    problems,
  };
}
