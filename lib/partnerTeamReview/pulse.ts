/**
 * Team pulse (p-par-team-review): how quickly a partner's own team answers its agent, and how many
 * conversations are waiting on the team right now.
 *
 * Both come from the partner chat. An agent message is one written by anyone outside the partner's
 * own team (the agency's people); a reply is the next message the team writes in the same
 * conversation. Automatic updates (system cards) are neither: nobody wrote them, so nobody owes
 * them an answer.
 *
 * Pure, so the rules are tested without a database; lib/partnerTeamReview/service.ts reads the rows.
 */
export type PulseMessage = {
  channelId: string;
  createdBy: string | null;
  createdAt: string;
  kind: string;
};

export type TeamPulse = {
  /** Mean minutes from an agent's message to the team's next reply, over replies in the window. */
  averageResponseMinutes: number | null;
  /** How many replies that mean is taken over, so a figure from two replies can say so. */
  responses: number;
  /** Conversations whose latest written message is the agent's, still unanswered. */
  pendingFollowUps: number;
};

export function teamPulse(
  messages: readonly PulseMessage[],
  teamUserIds: ReadonlySet<string>,
  window: { from: number; to: number },
): TeamPulse {
  const byChannel = new Map<string, PulseMessage[]>();
  for (const message of messages) {
    if (message.kind === "system_card" || !message.createdBy) continue;
    const list = byChannel.get(message.channelId) ?? [];
    list.push(message);
    byChannel.set(message.channelId, list);
  }

  let totalMinutes = 0;
  let responses = 0;
  let pendingFollowUps = 0;
  for (const list of byChannel.values()) {
    list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    // The clock starts at the first agent message nobody has answered yet; a burst of three agent
    // messages is one question, not three.
    let waitingSince: number | null = null;
    for (const message of list) {
      const at = Date.parse(message.createdAt);
      const fromTeam = teamUserIds.has(message.createdBy!);
      if (!fromTeam) {
        if (waitingSince === null) waitingSince = at;
        continue;
      }
      if (waitingSince !== null && waitingSince >= window.from && waitingSince <= window.to) {
        totalMinutes += (at - waitingSince) / 60_000;
        responses += 1;
      }
      waitingSince = null;
    }
    if (waitingSince !== null) pendingFollowUps += 1;
  }

  return {
    averageResponseMinutes: responses ? totalMinutes / responses : null,
    responses,
    pendingFollowUps,
  };
}

/** "42 min", "3 hr 5 min", "2 days" — a duration as the pulse card reads it. */
export function durationLabel(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 1) return "under a minute";
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  if (hours < 24) {
    const rest = whole % 60;
    return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}
