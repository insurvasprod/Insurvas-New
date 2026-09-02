export type ContactPhone = { phone: string; type: "mobile" | "landline" | "other"; is_primary: boolean };
export type ContactEmail = { email: string; is_primary: boolean };

export type ContactInput = {
  first_name: string;
  last_name: string;
  dob?: string | null;
  primary_phone?: string | null;
  email?: string | null;
  state?: string | null;
  address_line1?: string | null;
  city?: string | null;
  postal_code?: string | null;
  custom_fields?: Record<string, unknown>;
  phones?: ContactPhone[];
  emails?: ContactEmail[];
};

export type DuplicateMatch = {
  contact_id: string;
  household_id: string | null;
  first_name: string;
  last_name: string;
  dob: string | null;
  primary_phone: string | null;
  state: string | null;
  custom_fields: Record<string, unknown>;
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
  score: number;
  confidence: "high" | "medium" | "low";
  matched_on: string[];
};

export type ContactRow = {
  id: string;
  tenant_id: string;
  household_id: string | null;
  first_name: string;
  last_name: string;
  dob: string | null;
  primary_phone: string | null;
  state: string | null;
  custom_fields: Record<string, unknown>;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
  phones: ContactPhone[];
  emails: ContactEmail[];
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
};

export type FieldSchemaRow = {
  id: string;
  tenant_id: string;
  entity: "contact" | "lead" | "policy" | "application";
  field_key: string;
  label: string;
  type: "text" | "long_text" | "number" | "date" | "single_select" | "multi_select" | "boolean" | "currency" | "phone" | "email" | "ssn";
  options: string[];
  is_required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ContactWorkspace = {
  contacts: ContactRow[];
  fieldSchema: FieldSchemaRow[];
  merges: Array<{ id: string; kept_id: string; merged_id: string; merged_at: string; reversed_at: string | null }>;
};
