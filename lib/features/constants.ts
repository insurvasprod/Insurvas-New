// Client-safe: no `server-only` import here, so client components can use these types and
// helpers. Query functions live in ./queries, which is server-only.

export type FeatureRow = {
  id: string;
  feature_key: string;
  label: string;
  module: string;
  description: string | null;
  sort_order: number;
  is_archived: boolean;
};

export type FeatureModuleRow = {
  key: string;
  label: string;
  sort_order: number;
};

export type FeatureModuleGroup = {
  module: FeatureModuleRow;
  features: FeatureRow[];
};

/**
 * A feature_key becomes a `requireFeature('...')` guard and a menu node id, so it has to be
 * stable and machine-safe: lowercase, digits and underscores only.
 */
export const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const FEATURE_KEY_RULE = "Lowercase letters, digits and underscores only, starting with a letter";
