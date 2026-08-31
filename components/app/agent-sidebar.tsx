"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Building2 } from "lucide-react";

import type { MenuSection } from "@/lib/menu/definition";

/**
 * The agent's navigation, on a phone as well as a desktop.
 *
 * Two things changed here beyond the styling.
 *
 * It works below 768px. The shell was a fixed 240px column with no way to reach it on a phone —
 * which mattered because LA-0.1 requires the agent app to work on one, and an agent between
 * appointments is the person most likely to be holding a phone.
 *
 * And an item whose screen is not built yet says so, rather than looking identical to one that
 * works right up until it 404s. The dot is not a warning: these are features the customer has paid
 * for and will get. It is there so the sidebar stops over-promising what is clickable *today*.
 */
function NavList({ menu, onNavigate }: { menu: MenuSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-5">
      {menu.map((section) => (
        <div key={section.id}>
          <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-white/45">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const href = `/app/${item.id}`;
              const isActive = pathname === href;

              return (
                <li key={item.id}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 ${
                      isActive
                        ? "bg-white/15 font-semibold text-white"
                        : "text-white/80 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {!item.built && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-white/40"
                        title="On the way"
                        aria-label="On the way"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AgentSidebar({ menu, footer }: { menu: MenuSection[]; footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Phone: a bar that is always reachable, and a drawer over the content. */}
      <header
        data-print-hide
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-[var(--brand-700)] px-4 py-3 text-white md:hidden"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-ml-1 rounded-md p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2">
          <Building2 className="size-4" aria-hidden="true" />
          <span className="font-semibold tracking-tight">Insurvas</span>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto bg-[var(--brand-700)] p-4 text-white">
            <div>
              <div className="mb-6 flex items-center justify-between px-3">
                <div className="flex items-center gap-2">
                  <Building2 className="size-5" aria-hidden="true" />
                  <span className="font-semibold tracking-tight">Insurvas</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="rounded-md p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              {/* Tapping a link closes the drawer — otherwise it stays open over the page it just
                  navigated to, which reads as the tap having done nothing. */}
              <NavList menu={menu} onNavigate={() => setOpen(false)} />
            </div>
            {footer && <div className="mt-6 border-t border-white/10 pt-4">{footer}</div>}
          </div>
        </div>
      )}

      {/* Desktop: the column, unchanged in spirit. */}
      <aside
        data-print-hide
        className="hidden w-60 shrink-0 flex-col justify-between bg-[var(--brand-700)] p-4 text-white md:flex"
      >
        <div>
          <div className="mb-7 flex items-center gap-2 px-3">
            <Building2 className="size-5" aria-hidden="true" />
            <span className="font-semibold tracking-tight">Insurvas</span>
          </div>
          <NavList menu={menu} />
        </div>
        {footer && <div className="border-t border-white/10 pt-4">{footer}</div>}
      </aside>
    </>
  );
}
