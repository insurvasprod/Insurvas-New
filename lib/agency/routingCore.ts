/**
 * AG-0.10 · the pool's age, with no database (client-safe). Every unassigned lead shows how long it has waited;
 * the colour says when the wait has become money lost.
 */

export function ageLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

/** Under an hour: neutral. Under a day: warning. A day or more: danger. */
export function ageTone(minutes: number): "neutral" | "warning" | "danger" {
  if (minutes < 60) return "neutral";
  if (minutes < 24 * 60) return "warning";
  return "danger";
}
