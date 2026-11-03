"use client";

import { Toaster as SileoToaster } from "sileo";

/**
 * The one place toasts are drawn (2026-10-28: Sileo, owner pick). Mounted once, in app/layout.tsx,
 * so the app, admin and partner planes share it. Toasts are raised only through `lib/notify`.
 *
 * No `theme` prop on purpose: with one, Sileo paints its own fills and description greys per theme.
 * Without it, the colours come from the --toast-* tokens in app/globals.css, which flip with the
 * `.dark` class like every other token.
 */
export function Toaster() {
  return <SileoToaster position="top-right" />;
}
