"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { MenuItem, MenuSection } from "@/lib/menu/definition";
import { LEADS_IN_STEPS, leadsInStepLabel, leadsInStepOf } from "@/lib/leadSources/steps";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";

/**
 * Where you are, on the page (owner 2026-10-30): every page draws "Group › Page" above its title, as
 * Partner Chat does, and the top bar no longer names the page. The shell hands its server-filtered
 * menu down once; `PageHeader` asks for the trail of the page it heads.
 */
const MenuContext = createContext<MenuSection[] | null>(null);

export function PageTrailProvider({ menu, children }: { menu: MenuSection[]; children: ReactNode }) {
  return <MenuContext.Provider value={menu}>{children}</MenuContext.Provider>;
}

/** The page open now: the menu item with the longest path that holds the address. */
function currentItem(menu: MenuSection[], pathname: string): MenuItem | null {
  let best: MenuItem | null = null;
  for (const item of menu.flatMap((section) => section.items)) {
    if (pathname !== item.path && !pathname.startsWith(`${item.path}/`)) continue;
    if (!best || item.path.length > best.path.length) best = item;
  }
  return best;
}

/**
 * The places below a Lead sources step, as the page names them (Source › a campaign › a list): each
 * `main [data-leads-crumb]` in order, a link when it carries `data-leads-href`.
 */
function useLeadsCrumbs(pathname: string, on: boolean) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = [...document.querySelectorAll<HTMLElement>("main [data-leads-crumb]")]
          .map((element) => ({ label: element.dataset.leadsCrumb ?? "", href: element.dataset.leadsHref }))
          .filter((crumb) => crumb.label);
        setCrumbs((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      });
    };
    read();
    const main = document.querySelector("main");
    if (!main) return () => cancelAnimationFrame(frame);
    const observer = new MutationObserver(read);
    observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-leads-crumb"] });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pathname, on]);
  return crumbs;
}

/**
 * Group › Page, and › this page's own title when it sits below its menu page (a record, a step).
 * Home and Settings stand alone. Nothing when the shell gave no menu (admin, partner) or no menu
 * page holds the address: the title alone then says where you are.
 */
export function PageTrail({ title }: { title: string }) {
  const menu = useContext(MenuContext);
  const pathname = usePathname();
  const leadsStep = leadsInStepOf(pathname);
  const leadsCrumbs = useLeadsCrumbs(pathname, Boolean(leadsStep));
  if (!menu) return null;
  const item = currentItem(menu, pathname);
  if (leadsStep) {
    const stepHref = LEADS_IN_STEPS.find((step) => step.key === leadsStep)?.href;
    return <Breadcrumbs crumbs={[{ label: item?.section ?? "Leads" }, { label: "Lead Flow", href: LEADS_IN_STEPS[0]?.href }, { label: leadsInStepLabel(leadsStep), href: stepHref }, ...leadsCrumbs]} />;
  }
  if (!item) return null;
  const page = item.navLabel ?? item.label;
  const group = item.section === page ? null : item.section;
  const below = pathname !== item.path && title.trim() && title !== page;
  const crumbs: Crumb[] = [
    ...(group ? [{ label: group }] : []),
    { label: page, href: item.path },
    ...(below ? [{ label: title }] : []),
  ];
  // A lone crumb ("Home") is the title already.
  if (crumbs.length < 2) return null;
  return <Breadcrumbs crumbs={crumbs} />;
}
