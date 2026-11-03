/**
 * The live sentence on a dashboard tile (p-app-dashboard): "14 waiting, longest 4m 12s. Two past
 * the 2-minute SLA." Pure, so the wording is tested without a database. Each takes counts the
 * caller read and says only what those counts support.
 */
const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** "Two", "12" — a count opening a sentence, as the board writes it. */
function countWord(value: number) {
  return value < NUMBER_WORDS.length ? NUMBER_WORDS[value] : value.toLocaleString("en-US");
}

/** "4m 12s", "38s", "2h 5m" */
export function waitLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** "2-minute", "90-second" — the SLA as a compound adjective. */
function slaLabel(seconds: number) {
  return seconds % 60 === 0 ? `${seconds / 60}-minute` : `${seconds}-second`;
}

export function inboundSentence(input: { waiting: number; longestSeconds: number | null; pastSla: number; slaSeconds: number }): string {
  if (!input.waiting) return "Nobody is waiting right now.";
  const longest = input.longestSeconds === null ? "" : `, longest ${waitLabel(input.longestSeconds)}`;
  const past = input.pastSla ? ` ${countWord(input.pastSla)} past the ${slaLabel(input.slaSeconds)} SLA.` : "";
  return `${input.waiting.toLocaleString("en-US")} waiting${longest}.${past}`;
}

export function dialerSentence(ready: number): string {
  if (!ready) return "No leads are waiting to be dialled.";
  return `${ready.toLocaleString("en-US")} lead${ready === 1 ? "" : "s"} ready to dial.`;
}

export function callbacksSentence(dueToday: number, overdue: number): string {
  if (!dueToday && !overdue) return "Nothing due today.";
  const parts = [];
  if (dueToday) parts.push(`${dueToday.toLocaleString("en-US")} due today`);
  if (overdue) parts.push(`${overdue.toLocaleString("en-US")} overdue`);
  const text = parts.join(", ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

export function leadsSentence(thisWeek: number, total: number): string {
  if (!total) return "No leads yet.";
  return `${thisWeek.toLocaleString("en-US")} added in the last 7 days, ${total.toLocaleString("en-US")} in all.`;
}

export function policiesSentence(total: number): string {
  if (!total) return "No policies recorded yet.";
  return `${total.toLocaleString("en-US")} polic${total === 1 ? "y" : "ies"} in your book.`;
}

export function carriersSentence(active: number): string {
  if (!active) return "No carriers added yet.";
  return `${active.toLocaleString("en-US")} carrier${active === 1 ? "" : "s"} active in your library.`;
}

export function appointmentsSentence(onFile: number, states: number): string {
  if (!onFile) return "No appointments recorded yet.";
  return `${onFile.toLocaleString("en-US")} appointment${onFile === 1 ? "" : "s"} on file across ${states.toLocaleString("en-US")} state${states === 1 ? "" : "s"}.`;
}

export function poolSentence(unowned: number): string {
  if (!unowned) return "Every lead in the pool has an owner.";
  return `${unowned.toLocaleString("en-US")} lead${unowned === 1 ? "" : "s"} in the pool with no owner.`;
}

/** "42 dials this week, 38.1% reached." — reached is the SQL is_contact_disposition rule. */
export function activitySentence(dials: number, reached: number): string {
  if (!dials) return "No dials in the last 7 days.";
  return `${dials.toLocaleString("en-US")} dial${dials === 1 ? "" : "s"} this week, ${((Math.min(reached, dials) / dials) * 100).toFixed(1)}% reached.`;
}
