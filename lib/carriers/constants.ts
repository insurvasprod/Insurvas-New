export const CARRIER_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const CARRIER_CODE_RULE = "Lowercase letters, digits and underscores only, starting with a letter";

export type CarrierRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
