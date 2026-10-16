/** LA-7.6 · the words for a bank line's match state (no server imports: the screen uses these). */
export const MATCH_STATUS_LABELS = { unmatched: "Not matched", suggested: "Suggested", matched: "Matched", partially_matched: "Partly matched", ignored: "Ignored" } as const;
export type MatchStatus = keyof typeof MATCH_STATUS_LABELS;
