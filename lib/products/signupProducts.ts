// Sign-up's "What do you sell?" answer → the Insurvas catalogue (owner 2026-11-03: "whatever they
// select on sign up, they will be automatically added" to Settings › Products). Pure, so the mapping
// is tested on its own (signupProducts.test.mjs); lib/products/applySignupProducts.ts writes it.
//
// The sign-up words are broad lines (lib/signup/constants.ts PRODUCT_OPTIONS); the catalogue holds
// products with a category (life | health | retirement). A line maps to every catalogue product of
// its kind. Property & casualty and supplemental benefits have no catalogue product yet, so they
// switch nothing on.

export type CatalogueProduct = { code: string; category: string };

export function signupProductCodes(productsSold: readonly string[], catalogue: readonly CatalogueProduct[]): string[] {
  const picked = new Set(productsSold);
  return catalogue
    .filter((p) =>
      (picked.has("life") && p.category === "life")
      || (picked.has("health") && p.category === "health")
      || (picked.has("medicare") && p.code.startsWith("medicare"))
      || (picked.has("annuities") && (p.category === "retirement" || p.code === "annuity")))
    .map((p) => p.code);
}
