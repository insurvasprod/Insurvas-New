// Client-safe shapes for the agent's product configuration and the partner portal picker.

export type ProductConfiguration = {
  code: string;
  name: string;
  category: string;
  description: string | null;
  is_enabled: boolean;
  sort_order: number;
};

export type PartnerProductConfiguration = ProductConfiguration & {
  approved: boolean;
};
