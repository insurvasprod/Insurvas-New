/**
 * M1:wf:W3.1: a partner save that the database refuses answers in words, never with Postgres text
 * ('null value in column "contact_name" of relation "partners" violates not-null constraint').
 * The service layer only has the error message, so this reads its standard shapes. Codes the app
 * raises itself (partner_limit_reached, invalid_partner_transition, ...) are left to the caller.
 */
const FIELD_LABELS: Record<string, string> = {
  name: "Partner name",
  partner_type: "Partner type",
  country: "Country",
  contact_name: "Contact name",
  contact_email: "Contact email",
  timezone: "Time zone",
  notes: "Notes",
  status: "Status",
};

const CONSTRAINT_COPY: Record<string, string> = {
  partners_contact_name_length: "Contact name must be 200 characters or fewer.",
  partners_partner_type_check: "Choose publisher, marketing or affiliate.",
  partners_status_check: "That partner status is not allowed.",
};

function fieldLabel(column: string) {
  return FIELD_LABELS[column] ?? column.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** A friendly sentence for a raw database refusal, or null when the message is not one. */
export function friendlyPartnerDbError(message: string): string | null {
  const notNull = /null value in column "([^"]+)"/.exec(message);
  if (notNull) return `${fieldLabel(notNull[1])} is required.`;
  const check = /violates check constraint "([^"]+)"/.exec(message);
  if (check) return CONSTRAINT_COPY[check[1]] ?? "One of the partner details is not valid. Check the form and try again.";
  if (/duplicate key value violates unique constraint/.test(message)) return "A partner with these details already exists.";
  if (/violates foreign key constraint/.test(message)) return "Something this partner refers to no longer exists. Refresh the page and try again.";
  if (/value too long for type/.test(message)) return "One of the partner details is too long.";
  if (/invalid input (syntax|value) for/.test(message)) return "One of the partner details has the wrong format.";
  if (/invalid_partner_type/.test(message)) return CONSTRAINT_COPY.partners_partner_type_check;
  // Anything else that still reads like database internals is not shown as it is.
  if (/\b(relation|column|constraint|violates|syntax error|permission denied)\b|"[a-z_]+"\s+of relation/i.test(message))
    return "The partner could not be saved. Check the details and try again.";
  return null;
}
