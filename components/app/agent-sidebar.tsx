"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { MenuSection } from "@/lib/menu/definition";

/** Renders whatever buildAgentMenu() produced — no per-plan branching anywhere. */
export function AgentSidebar({ menu }: { menu: MenuSection[] }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-4">
      {menu.map((section) => (
        <div key={section.id}>
          <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-white/50">
            {section.label}
          </p>
          {section.items.map((item) => {
            const href = `/app/${item.id}`;
            const isActive = pathname === href;

            return (
              <Link
                key={item.id}
                href={href}
                className="block rounded-md px-3 py-1.5 text-sm transition-colors"
                style={{
                  background: isActive ? "rgba(255,255,255,0.14)" : "transparent",
                  fontWeight: isActive ? 600 : 400,
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
