/**
 * The dialer's outcome buttons, read from the ONE disposition vocabulary (M1 LA-1.12-4).
 *
 * Since 20260929200000 every dialer outcome is a row in the tenant's `dispositions` table, and
 * `dispositions.dialer_position` says which button (and number key) it sits on. The route and the
 * workspace both take the list from there (loadDialerOutcomes in ./service.ts), so renaming,
 * archiving or re-timing an outcome in Settings › Dispositions is what the dialer does.
 *
 * FALLBACK_DIALER_OUTCOMES is the list the dialer had before that migration. It is used ONLY while
 * no row of the tenant carries a dialer position (the migration not applied yet, or its read
 * failing), and lib/dispositions/oneVocabulary.test.mjs pins it to the migration's seed so the two
 * cannot drift. Delete it once 20260929200000 is live everywhere.
 *
 * Pure and free of `server-only`, so the workspace, the service and the tests can all use it.
 */

export type DialerOutcome = { key: string; label: string; position: number };

/** The one outcome offered only on the search path: the customer rang back (decision 1). */
export const INBOUND_RETURN_CALL = "inbound_return_call";

/** The application outcome: "Interested – start application" on the dialer (LA-2.9-3, LA-2.14). */
export const APPLICATION_OUTCOME = "application_submitted";

/** Before 20260929200000: the same keys, labels and keyboard order the migration seeds. */
export const FALLBACK_DIALER_OUTCOMES: readonly DialerOutcome[] = [
  { key: "no_answer", label: "No answer", position: 1 },
  { key: "callback_scheduled", label: "Callback", position: 2 },
  { key: "not_interested", label: "Not interested", position: 3 },
  { key: "application_submitted", label: "Application", position: 4 },
  { key: "voicemail", label: "Voicemail", position: 5 },
  { key: "busy", label: "Busy", position: 6 },
  { key: "call_dropped", label: "Call dropped", position: 7 },
  { key: "do_not_call", label: "Do not call", position: 8 },
  { key: "wrong_number", label: "Wrong number", position: 9 },
  { key: "disconnected", label: "Disconnected", position: 10 },
];
export const FALLBACK_INBOUND_RETURN_LABEL = "Inbound return call";

export type DialerVocabulary = {
  /** "tenant" = read from the dispositions table; "fallback" = the pre-migration list above. */
  source: "tenant" | "fallback";
  /** Active outcomes with a dialer position, in button order. */
  outcomes: DialerOutcome[];
  /** The inbound return call when it is available (active row, or the fallback). */
  inboundReturnCall: { key: string; label: string } | null;
  /** Every label the tenant has, for the call history ("No answer", "Callback scheduled"). */
  labels: Record<string, string>;
};

export type DispositionVocabularyRow = { disposition_key: string; label: string; is_active: boolean; dialer_position: number | null };

/**
 * The dialer's vocabulary from the tenant's rows. `rows` null (the column is missing, or the read
 * failed) or no row with a dialer position → the fallback list.
 */
export function dialerVocabulary(rows: DispositionVocabularyRow[] | null): DialerVocabulary {
  const positioned = (rows ?? []).filter((row) => typeof row.dialer_position === "number" && row.dialer_position >= 1);
  if (!rows || positioned.length === 0) {
    const labels: Record<string, string> = Object.fromEntries(FALLBACK_DIALER_OUTCOMES.map((row) => [row.key, row.label]));
    labels[INBOUND_RETURN_CALL] = FALLBACK_INBOUND_RETURN_LABEL;
    for (const row of rows ?? []) labels[row.disposition_key] ??= row.label;
    return { source: "fallback", outcomes: [...FALLBACK_DIALER_OUTCOMES], inboundReturnCall: { key: INBOUND_RETURN_CALL, label: FALLBACK_INBOUND_RETURN_LABEL }, labels };
  }
  const outcomes = positioned
    .filter((row) => row.is_active)
    .map((row) => ({ key: row.disposition_key, label: row.label, position: Number(row.dialer_position) }))
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const inbound = rows.find((row) => row.disposition_key === INBOUND_RETURN_CALL && row.is_active) ?? null;
  return {
    source: "tenant",
    outcomes,
    inboundReturnCall: inbound ? { key: inbound.disposition_key, label: inbound.label } : null,
    labels: Object.fromEntries(rows.map((row) => [row.disposition_key, row.label])),
  };
}

/** The keys the disposition route accepts without a tenant row: the fallback's, and only then. */
export function fallbackOutcomeKeys(vocabulary: DialerVocabulary): string[] {
  if (vocabulary.source !== "fallback") return [];
  return [...vocabulary.outcomes.map((row) => row.key), INBOUND_RETURN_CALL];
}

/** What a setter's dialer offers: everything but the application (LA-2.12, a setter never sells). */
export function outcomesForRole(outcomes: readonly DialerOutcome[], isSetter: boolean): DialerOutcome[] {
  return isSetter ? outcomes.filter((row) => row.key !== APPLICATION_OUTCOME) : [...outcomes];
}

/** The key a button is picked with: 1–9 for the first nine, 0 for the tenth, none after that. */
export function outcomeHotkey(index: number): string | null {
  if (index >= 0 && index <= 8) return String(index + 1);
  if (index === 9) return "0";
  return null;
}

/** The inverse: the index a key press picks, or null. */
export function outcomeIndexForKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return key === "0" ? 9 : Number(key) - 1;
}

/** The button text: the application outcome reads as the action it starts. */
export function outcomeButtonLabel(outcome: DialerOutcome): string {
  return outcome.key === APPLICATION_OUTCOME ? "Interested – start application" : outcome.label;
}
