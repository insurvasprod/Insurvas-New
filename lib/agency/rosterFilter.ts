import type { ProducerStatus } from "./constants.ts";

/**
 * Team › Producers' filter (`?status=`): everyone not offboarded, all, one status, or `blocked` — the working
 * producers the AG-1.10 gate still stops from submitting. A plain module, so the server page can read it.
 */
export type RosterFilter = "current" | "all" | "blocked" | ProducerStatus;
const FILTERS: RosterFilter[] = ["current", "all", "blocked", "active", "onboarding", "invited", "suspended", "offboarded"];
export const rosterFilterOf = (value: string | undefined): RosterFilter => (FILTERS.includes(value as RosterFilter) ? (value as RosterFilter) : "current");
