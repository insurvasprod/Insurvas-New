/**
 * What the floor can say about a waiting caller from the lead's own values. Plain module (no
 * server-only imports) so it can be tested directly.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** "es" → "Spanish", "spanish" → "Spanish", "Tagalog" → "Tagalog". Null when nothing is recorded. */
export function languageFromLeadValues(values: Record<string, unknown>): string | null {
  const raw = text(values.language) || text(values.preferred_language) || text(values.language_code);
  if (!raw) return null;
  // A bare code (en, es, pt-BR, zh_Hant) reads as its English name when the platform knows it.
  if (/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/i.test(raw)) {
    try {
      const name = new Intl.DisplayNames(["en"], { type: "language" }).of(raw.replace("_", "-"));
      if (name && name.toLowerCase() !== raw.toLowerCase()) return name;
    } catch {
      // Not a valid tag; fall through and show it as written.
    }
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function phoneFromLeadValues(values: Record<string, unknown>): string | null {
  const raw = text(values.phone) || text(values.phone_number) || text(values.mobile_phone);
  return raw || null;
}
