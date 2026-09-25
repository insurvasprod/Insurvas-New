/**
 * Which verification fields are sensitive, and what the screen shows of them before "Reveal".
 *
 * Plain module (no `server-only`): the inbound verification route masks the panel with it and the
 * panel component asks it which rows carry a Reveal control.
 *
 * The rule is the partner portal's (lib/partnerLeads/mask.ts SENSITIVE_PARTNER_KEY): keyed on the
 * field name, never guessed from the value — SSN, banking details (routing, account, institution,
 * IBAN, SWIFT), policy numbers and card numbers. One list, so a field that is masked for a partner
 * is masked for an agent reading it back on a call, and a banking field added to a template later
 * is covered on both screens at once.
 *
 * Masked means the last four characters only ("•••• 4021"). The full value leaves the server only
 * through POST /api/app/inbound/verification/reveal, which writes an audit row first.
 */
import { SENSITIVE_PARTNER_KEY } from "../partnerLeads/mask.ts";

export function isSensitiveFieldKey(fieldKey: string) {
  return SENSITIVE_PARTNER_KEY.test(fieldKey);
}

/** "•••• 4021" for a value, "" for nothing. Four characters or fewer show no characters at all. */
export function maskLastFour(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  const compact = text.replace(/\s+/g, "");
  if (compact.length <= 4) return "••••";
  return `•••• ${compact.slice(-4)}`;
}

type PanelFieldLike = { field_key: string; old_value?: unknown; new_value?: unknown };
type PanelLike = { lead: { values: Record<string, unknown> }; sections: Array<{ fields: PanelFieldLike[] }> };

/**
 * The panel with every sensitive value replaced by its masked form — the lead's value and the
 * verification row's old/new copies — plus the list of keys that were masked, so the screen knows
 * not to seed a correction draft with the mask. Everything else is returned unchanged.
 */
export function maskSensitivePanel<T extends PanelLike>(panel: T): T & { sensitiveKeys: string[] } {
  const keys = new Set<string>();
  for (const section of panel.sections) for (const field of section.fields) if (isSensitiveFieldKey(field.field_key)) keys.add(field.field_key);
  for (const key of Object.keys(panel.lead.values)) if (isSensitiveFieldKey(key)) keys.add(key);
  if (keys.size === 0) return { ...panel, sensitiveKeys: [] };
  const values = { ...panel.lead.values };
  for (const key of keys) if (key in values) values[key] = maskLastFour(values[key]);
  return {
    ...panel,
    lead: { ...panel.lead, values },
    sections: panel.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => keys.has(field.field_key)
        ? { ...field, old_value: field.old_value == null ? field.old_value : maskLastFour(field.old_value), new_value: field.new_value == null ? field.new_value : maskLastFour(field.new_value) }
        : field),
    })),
    sensitiveKeys: [...keys],
  };
}
