/**
 * GET /api/app/partner-chat (owner and producer, inbound_transfers): the conversations this person is
 * in, each with its newest messages and unread count, and the directory that names their writers.
 * Board H2 draws one row per conversation from exactly this; nothing else.
 */
export type ChatMessage = { id: string; message: string; messageKind: "text" | "system_card"; createdBy: string | null; createdAt: string };
export type ChatEntry = {
  channel: { id: string; name: string; channel_type: "partner" | "direct" | "group"; status: "active" | "archived" };
  messages: ChatMessage[];
  unreadCount: number;
  state?: { archivedAt: string | null; pinnedAt: string | null };
};
type Person = { user_id: string; role?: string | null; partner_id?: string | null; users: { name: string | null; email: string | null; status?: string | null } | null; partners?: { name: string | null } | null };
export type ChatsAnswer = { channels: ChatEntry[]; directory: { tenantUsers: Person[]; partnerUsers: Person[] }; viewerId: string };

export type ChatRow = { id: string; name: string; kind: ChatEntry["channel"]["channel_type"]; preview: string | null; at: string | null; unread: number; pinned?: boolean };

function firstNames(answer: Pick<ChatsAnswer, "directory">): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of [...(answer.directory?.tenantUsers ?? []), ...(answer.directory?.partnerUsers ?? [])]) {
    const name = p.users?.name?.trim() || p.users?.email || "";
    if (name) names.set(p.user_id, name.split(/\s+/)[0]);
  }
  return names;
}

/**
 * Board H2: one row per conversation, groups first — conversations with several people (a partner's channel,
 * a team group) before one-to-one messages — and newest first within each; archived left out. A conversation
 * this person pinned (H3's more menu) comes before all of them. The preview is "You: …" or the writer's first name.
 */
export function chatRows(answer: ChatsAnswer): ChatRow[] {
  const names = firstNames(answer);
  const rank = (r: ChatRow) => (r.pinned ? 0 : r.kind === "direct" ? 2 : 1);
  return answer.channels
    .filter((c) => c.channel.status === "active" && !c.state?.archivedAt)
    .map((c) => {
      const last = c.messages[c.messages.length - 1] ?? null;
      const who = !last || last.messageKind === "system_card" || !last.createdBy ? null : last.createdBy === answer.viewerId ? "You" : names.get(last.createdBy) ?? null;
      const text = last?.message.replace(/\s+/g, " ").trim() || null;
      return { id: c.channel.id, name: c.channel.name, kind: c.channel.channel_type, preview: text ? (who ? `${who}: ${text}` : text) : null, at: last?.createdAt ?? null, unread: c.unreadCount, pinned: Boolean(c.state?.pinnedAt) };
    })
    .sort((a, b) => rank(a) - rank(b) || (b.at ?? "").localeCompare(a.at ?? ""));
}

/** H2's search, on the conversations already loaded: a name or a word in the newest message. */
export function filterChatRows(rows: ChatRow[], query: string): ChatRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || (r.preview ?? "").toLowerCase().includes(q));
}

/** GET /api/app/partner-chat?search= — messages holding the words, in every conversation the person can open. */
export type ChatSearchHit = { messageId: string; channelId: string; createdAt: string; createdBy: string | null; message: string; messageKind: "text" | "system_card"; cardType: string | null; fileName: string | null };
export type ChatSearchAnswer = { hits: ChatSearchHit[]; truncated: boolean };

/** A search hit as a row: the conversation's name, then "Maya: …the words…". */
export function hitRows(answer: ChatsAnswer, hits: ChatSearchHit[]): { id: string; channelId: string; name: string; text: string; at: string }[] {
  const names = firstNames(answer);
  const channels = new Map(answer.channels.map((c) => [c.channel.id, c.channel.name]));
  return hits.map((h) => {
    const who = h.messageKind === "system_card" || !h.createdBy ? null : h.createdBy === answer.viewerId ? "You" : names.get(h.createdBy) ?? null;
    const body = h.fileName ?? h.message.replace(/\s+/g, " ").trim();
    return { id: h.messageId, channelId: h.channelId, name: channels.get(h.channelId) ?? "Conversation", text: who ? `${who}: ${body}` : body, at: h.createdAt };
  });
}

/**
 * Who a new message can go to (the route's create_channel, board H2's pencil): the agency's people and the
 * partners' people in the chat directory, never the person themself, only active accounts. Partners never
 * see each other, so the server refuses a conversation with people from two partners.
 */
export type ChatPerson = { id: string; name: string; meta: string; partnerId: string | null };
export function chatPeople(answer: ChatsAnswer): ChatPerson[] {
  const label = (p: Person) => p.users?.name?.trim() || p.users?.email || "";
  const active = (p: Person) => !p.users?.status || p.users.status === "active";
  const seen = new Set<string>([answer.viewerId]);
  const out: ChatPerson[] = [];
  for (const p of answer.directory?.tenantUsers ?? []) {
    if (seen.has(p.user_id) || !active(p) || !label(p)) continue;
    seen.add(p.user_id);
    out.push({ id: p.user_id, name: label(p), meta: roleWord(p.role), partnerId: null });
  }
  for (const p of answer.directory?.partnerUsers ?? []) {
    if (seen.has(p.user_id) || !active(p) || !label(p)) continue;
    seen.add(p.user_id);
    out.push({ id: p.user_id, name: label(p), meta: p.partners?.name ?? "Partner", partnerId: p.partner_id ?? null });
  }
  return out.sort((a, b) => Number(Boolean(a.partnerId)) - Number(Boolean(b.partnerId)) || a.name.localeCompare(b.name));
}

function roleWord(role: string | null | undefined): string {
  if (!role) return "Team";
  const r = role.replace(/_/g, " ");
  return r.charAt(0).toUpperCase() + r.slice(1);
}
