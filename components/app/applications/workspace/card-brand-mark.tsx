/**
 * The card networks' marks on a small card shape (Payment step, owner 2026-10-28): the row of cards we
 * accept above the number, and the one the typed number belongs to under it. Drawn inline so they need
 * no image files; the colours are the --card-* tokens in app/globals.css.
 */

import { CARD_BRANDS, type CardBrand } from "@/lib/applications/formats";
import { cn } from "@/lib/utils";

export const CARD_BRAND_LABEL: Record<CardBrand, string> = { visa: "Visa", mastercard: "Mastercard", discover: "Discover", amex: "American Express" };

export function CardBrandMark({ brand, className, dim = false }: { brand: CardBrand; className?: string; dim?: boolean }) {
  return (
    <svg viewBox="0 0 38 24" role="img" aria-label={CARD_BRAND_LABEL[brand]} className={cn("h-6 w-[38px] shrink-0 transition-opacity duration-200", dim && "opacity-30 grayscale", className)}>
      <rect x="0.5" y="0.5" width="37" height="23" rx="3.5" fill={brand === "amex" ? "var(--card-amex)" : "white"} stroke="var(--border-strong)" />
      {brand === "visa" && (
        <text x="19" y="16" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="10.5" fontStyle="italic" fontWeight="800" letterSpacing="0.4" fill="var(--card-visa)">VISA</text>
      )}
      {brand === "mastercard" && (
        <>
          <circle cx="15" cy="12" r="7" fill="var(--card-mc-red)" />
          <circle cx="23" cy="12" r="7" fill="var(--card-mc-amber)" />
          <path d="M19 6.26A7 7 0 0 1 19 17.74A7 7 0 0 1 19 6.26Z" fill="var(--card-mc-mix)" />
        </>
      )}
      {brand === "discover" && (
        <>
          <text x="4" y="14" fontFamily="Arial, Helvetica, sans-serif" fontSize="6.4" fontWeight="700" letterSpacing="-0.1" fill="black">DISC</text>
          <circle cx="22.4" cy="11.8" r="2.7" fill="var(--card-discover)" />
          <text x="25.4" y="14" fontFamily="Arial, Helvetica, sans-serif" fontSize="6.4" fontWeight="700" letterSpacing="-0.1" fill="black">VER</text>
          <path d="M14 23.5H34A3.5 3.5 0 0 0 37.5 20V16Q30 21 14 23.5Z" fill="var(--card-discover)" />
        </>
      )}
      {brand === "amex" && (
        <text x="19" y="15.4" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="8.4" fontWeight="800" letterSpacing="0.3" fill="white">AMEX</text>
      )}
    </svg>
  );
}

/** Every card we accept; the typed number's brand stays lit and the others fade. */
export function AcceptedCards({ active, className }: { active: CardBrand | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-label="Cards we accept: Visa, Mastercard, Discover, American Express">
      {CARD_BRANDS.map((b) => <CardBrandMark key={b} brand={b} dim={active !== null && active !== b} />)}
    </span>
  );
}
