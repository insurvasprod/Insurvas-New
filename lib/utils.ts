import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to be told about the type steps defined in app/globals.css (`--text-*`).
 * Without it, `text-label` or `text-card-title` reads as a text colour, and a colour class after it
 * (`text-label text-muted-foreground`) silently drops the size (found 2026-10-28, foundation v3).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "card-title", "page", "title-sm", "title-md", "title-lg", "headline-lg", "hero"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
