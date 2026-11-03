/**
 * Whether an import may mark its campaign `scrubbed`. Pure, so node --test can drive it.
 *
 * An import screens ITS OWN rows. That makes the campaign scrubbed only when every lead in it has now
 * been screened: the campaign was already scrubbed (its older leads passed a scrub), or it held no
 * leads before this import (a new list). Otherwise only the new rows were scrubbed, and the campaign
 * keeps the status that blocks it until a full re-scrub runs:
 *   - `failed`     — its last scrub failed; an import must not paper over that.
 *   - `scrubbing`  — a run is in progress and will set the outcome itself.
 *   - `unscrubbed` with older leads — never scrubbed, or a re-scrub was requested
 *                    (request_campaign_rescrub), so its older leads are of unknown status.
 * The mark is written conditionally on the status read here, so a re-scrub requested in between wins.
 */
export type ImportScrubDecision = { mark: true } | { mark: false; reason: string };

export function importScrubDecision(prior: { scrubStatus: string | null; hadLeadsBefore: boolean }): ImportScrubDecision {
  switch (prior.scrubStatus ?? "unscrubbed") {
    case "scrubbed":
      return { mark: true };
    case "failed":
      return { mark: false, reason: "The new rows were scrubbed, but this campaign's last full scrub failed, so the dialer will not serve it until a scrub completes. Use Run the scrub on Vendors & campaigns." };
    case "scrubbing":
      return { mark: false, reason: "The new rows were scrubbed, but this campaign is being scrubbed now; its leads are served when that scrub finishes." };
    default:
      return prior.hadLeadsBefore
        ? { mark: false, reason: "The new rows were scrubbed, but this campaign's earlier leads still need a full scrub, so the dialer will not serve it until one completes. Use Run the scrub on Vendors & campaigns." }
        : { mark: true };
  }
}
