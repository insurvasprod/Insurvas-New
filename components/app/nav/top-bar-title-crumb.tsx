"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Where you are, for the shells with no agent menu to read (admin and partner, 2026-10-28): the
 * page's own title, which PageHeader keeps as a hidden `<h1 data-page-title>` now that pages draw no
 * visible title. Re-read on every navigation and whenever the page streams in, at most once a frame.
 */
export function TopBarTitleCrumb() {
  const pathname = usePathname();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTitle(document.querySelector("main [data-page-title]")?.textContent?.trim() || null));
    };
    read();
    const main = document.querySelector("main");
    if (!main) return () => cancelAnimationFrame(frame);
    const observer = new MutationObserver(read);
    observer.observe(main, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pathname]);
  if (!title) return null;
  return (
    <nav aria-label="Breadcrumb" className="portal-top-crumb">
      <span className="portal-top-crumb-page" aria-current="page">{title}</span>
    </nav>
  );
}
