export function partnerProductHttpError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "partner_product_not_approved" || message === "product_not_enabled" ? 403 : 404;
  const publicMessage = message === "partner_product_not_approved"
    ? "This partner is not approved for that product"
    : message === "product_not_enabled"
      ? "That product is disabled for this tenant"
      : message === "product_not_found" || message === "product_archived"
        ? "That product is not available in the catalog"
        : message.includes("No configured form")
          ? "No configured form is available for this product"
          : fallback;
  return { message: publicMessage, status };
}
