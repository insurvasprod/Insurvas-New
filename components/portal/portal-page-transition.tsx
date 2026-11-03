"use client";

import { usePathname } from "next/navigation";

/**
 * Remounts route content per pathname, so each page's own m-stagger entrance replays on navigation
 * (back/forward included) without turning the server layouts into client components.
 *
 * It has no animation of its own any more — `display: contents` in globals.css. It used to add a
 * 200ms rise, which stacked on the page's m-stagger so every page arrived twice.
 */
export function PortalPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="portal-page-transition" key={pathname}>
      {children}
    </div>
  );
}
