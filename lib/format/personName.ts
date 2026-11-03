/**
 * A person's name as a person writes it. Carrier files often send names in capitals ("SONYA GALLAGHER") or
 * all lowercase; those are shown "Sonya Gallagher". A name that already mixes cases is left exactly as typed
 * (McDonald, de la Cruz), and so is anything that is not letters (a policy number standing in for a name).
 */
export function personName(raw: string | null | undefined): string {
  const text = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!text || !/[a-z]/i.test(text)) return text;
  const mixed = text !== text.toUpperCase() && text !== text.toLowerCase();
  if (mixed) return text;
  return text.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}
