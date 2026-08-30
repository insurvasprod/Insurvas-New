// Client-safe product catalog definitions. Database access lives in ./queries.

export const PRODUCT_CATEGORIES = ["life", "health", "retirement"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  life: "Life",
  health: "Health",
  retirement: "Retirement",
};

export const PRODUCT_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const PRODUCT_CODE_RULE = "Lowercase letters, digits and underscores only, starting with a letter";

export type ProductRow = {
  id: string;
  code: string;
  name: string;
  category: ProductCategory;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
