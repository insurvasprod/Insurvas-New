/** The submitted application can use a generated key or a human-authored field label. */
export function partnerLeadLanguage(values: unknown): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  for (const [key, value] of Object.entries(values)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKey !== "language" && normalizedKey !== "preferredlanguage") continue;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return null;
}
