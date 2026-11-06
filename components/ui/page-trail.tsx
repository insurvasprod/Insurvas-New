"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { MenuItem, MenuSection } from "@/lib/menu/definition";
import { LEADS_IN_STEPS, leadsInStepLabel, leadsInStepOf } from "@/lib/leadSources/steps";
import { COMPLIANCE_STEPS, complianceStepLabel, complianceStepOf } from "@/lib/compliance/steps";
import { REPORTS_VIEWS, reportsViewLabel, reportsViewOf } from "@/lib/reports/views";
import { AREA_LABELS, DATA_IN_STEPS, areaOfStep, areaSteps, bookAreaOf, dataInStepLabel } from "@/lib/dataIn/steps";
import { accountingStepHref, accountingStepLabel, accountingStepOf } from "@/lib/accounting/steps";
import { commissionsStepLabel, commissionsStepOf } from "@/lib/commissions/steps";
import { agencyStepHref, agencyStepLabel, agencyStepOf } from "@/lib/agency/steps";
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

/** The shell's server-filtered menu (null outside the agent shell): a page menu that offers only what the sidebar does. */
export function useMenuSections(): MenuSection[] | null {
  return useContext(MenuContext);
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
  // A Compliance step (2026-10-30): Compliance › the step, named as the rail names it, and › the record it has
  // open (a complaint, a request, a certificate; foundation pass 2026-11-03).
  const complianceStep = complianceStepOf(pathname);
  if (complianceStep) {
    const stepHref = COMPLIANCE_STEPS.find((step) => step.key === complianceStep)?.href;
    const label = complianceStepLabel(complianceStep);
    // A record can sit at the step's own address (Evidence's ?phone= report, a ?focus= finding): its title says so.
    const below = title.trim() && title !== label;
    return <Breadcrumbs crumbs={[{ label: "Compliance", href: COMPLIANCE_STEPS[0]?.href }, { label, href: stepHref }, ...(below ? [{ label: title }] : [])]} />;
  }
  // A Reports view (2026-10-30): Reports › the view, and › the record it has open (a partner).
  const reportsView = reportsViewOf(pathname);
  if (reportsView) {
    const view = REPORTS_VIEWS.find((entry) => entry.key === reportsView);
    const label = reportsViewLabel(reportsView);
    // A record names the title (a partner, an agent, a drill on the view's own address: ?drill=).
    const below = view && title.trim() && title !== label;
    return <Breadcrumbs crumbs={[{ label: "Reports" }, { label, href: view?.href }, ...(below ? [{ label: title }] : [])]} />;
  }
  // A Book of business or Carrier sync step (2026-11-02; two areas since 2026-11-05): the area › the step, named as
  // the rail names it, and › the record it has open (a file, an item, a policy, a rule).
  const dataInStep = bookAreaOf(pathname);
  if (dataInStep) {
    const area = areaOfStep(dataInStep);
    const stepHref = DATA_IN_STEPS.find((step) => step.key === dataInStep)?.href;
    const label = dataInStepLabel(dataInStep);
    const below = pathname !== stepHref && title.trim() && title !== label;
    return <Breadcrumbs crumbs={[{ label: AREA_LABELS[area], href: areaSteps(area)[0]?.href }, { label, href: stepHref }, ...(below ? [{ label: title }] : [])]} />;
  }
  // An Accounting step (2026-11-02): Accounting › the step (My balance on its own address), and › the record it
  // has open (an invoice, a producer, a payee, a P&L line; foundation pass 2026-11-03).
  const accountingStep = accountingStepOf(pathname);
  if (accountingStep) {
    const label = accountingStepLabel(accountingStep, pathname);
    const stepHref = accountingStepHref(accountingStep, pathname);
    const below = pathname !== stepHref && title.trim() && title !== label;
    return <Breadcrumbs crumbs={[{ label: "Accounting" }, { label, href: stepHref }, ...(below ? [{ label: title }] : [])]} />;
  }
  // Home › Agency (Team rearranged, 2026-11-03): "Home › Agency dashboard"; under it "Home › Agency › Producers", and
  // › the record it has open (a producer, the invite form). Agency links back to the dashboard: there is no rail.
  const agencyStep = agencyStepOf(pathname);
  if (agencyStep) {
    const label = agencyStepLabel(agencyStep);
    const stepHref = agencyStepHref(agencyStep);
    const below = pathname !== stepHref && title.trim() && title !== label;
    const agency = agencyStep === "overview" ? [] : [{ label: "Agency", href: agencyStepHref("overview") }];
    return <Breadcrumbs crumbs={[{ label: "Home" }, ...agency, { label, href: stepHref }, ...(below ? [{ label: title }] : [])]} />;
  }
  // A Commissions step (2026-11-02): Commissions › the step (My pay on its own address).
  const commissionsStep = commissionsStepOf(pathname);
  if (commissionsStep) return <Breadcrumbs crumbs={[{ label: "Commissions" }, { label: commissionsStepLabel(commissionsStep, pathname), href: pathname }]} />;
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
