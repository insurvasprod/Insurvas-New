"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { MenuSection } from "@/lib/menu/definition";
import { parseSettingsHash, titleLabel } from "@/lib/settings/registry";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";

/** Page-level context for destinations whose sidebar parent differs from their page name. */
export function AppPageBreadcrumbs({ menu }: { menu: MenuSection[] }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const [hash, setHash] = useState("");
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  if (pathname === "/app/settings") {
    const { tab, anchor } = parseSettingsHash(hash);
    const section = SETTINGS_SECTIONS.find((item) => item.id === tab);
    if (!section) return null;
    const profileArea = tab === "my-profile" ? (
      anchor === "security-log" || anchor === "changes" ? "History"
        : anchor?.startsWith("security-") || anchor === "security" ? "Signing in"
          : anchor?.startsWith("notify-") || anchor === "notifications" ? "Alerts"
            : anchor?.startsWith("profile-") || anchor === "profile" ? "About you"
              : undefined
    ) : undefined;
    const detail = section.items?.find((item) => item.anchor === anchor)?.label;

    return (
      <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-[var(--muted)]">
        <span>Settings</span>
        <span aria-hidden="true" className="text-[var(--muted)]/70">›</span>
        <span className={profileArea || detail ? undefined : "font-medium text-[var(--body)]"} aria-current={profileArea || detail ? undefined : "page"}>{titleLabel(section.label)}</span>
        {profileArea && <>
          <span aria-hidden="true" className="text-[var(--muted)]/70">›</span>
          <span className={detail ? undefined : "font-medium text-[var(--body)]"} aria-current={detail ? undefined : "page"}>{profileArea}</span>
        </>}
        {detail && <>
          <span aria-hidden="true" className="text-[var(--muted)]/70">›</span>
          <span aria-current="page" className="font-medium text-[var(--body)]">{detail}</span>
        </>}
      </nav>
    );
  }

  const current = menu.flatMap((section) => section.items.map((item) => ({ section, item })))
    .find(({ item }) => item.path.replace(/\/$/, "") === pathname);
  if (!current) return null;
  const page = current.item.navLabel ?? current.item.label;
  if (current.section.label === page) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-[var(--muted)]">
      <span>{current.section.label}</span>
      <span aria-hidden="true" className="text-[var(--muted)]/70">›</span>
      <span aria-current="page" className="font-medium text-[var(--body)]">{page}</span>
    </nav>
  );
}
