import { allMenuItems } from "../menu/definition.ts";

import { SETTINGS_INDEX as SETTINGS_DOCS } from "./settingsIndex.ts";

/** How to reach a page from the menu: the clicks, in order, and the page's own address. */
export type DocWhere = { trail: string[]; href: string };

const MENU = allMenuItems()
  .map((item) => ({ path: item.path, trail: [item.sectionLabel, item.label] }))
  .sort((a, b) => b.path.length - a.path.length);

/**
 * Where a Docs step happens, as the menu clicks that reach it (owner 2026-11-17: the step panel says "the steps you
 * need to take to go to that page"). A Settings page is Settings › its group › its title; any other page is its menu
 * section › its menu item, matched on the longest path. Null for an address outside the menu.
 */
export function docWhere(href: string | undefined | null): DocWhere | null {
  if (!href) return null;
  const setting = SETTINGS_DOCS.find((page) => page.href === href.replace(/\?[^#]*/, ""))
    ?? SETTINGS_DOCS.find((page) => href.startsWith(page.href.split("#")[0]) && !page.href.includes("#"));
  if (setting) return { trail: ["Settings", setting.group, setting.title], href: setting.href };
  const path = href.split(/[?#]/)[0];
  if (path === "/app/settings") {
    const hash = href.split("#")[1]?.split("/")[0];
    const panel = hash ? SETTINGS_DOCS.find((page) => page.href === `/app/settings#${hash}`) : undefined;
    return panel ? { trail: ["Settings", panel.group, panel.title], href: panel.href } : { trail: ["Settings"], href: "/app/settings" };
  }
  const hit = MENU.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  return hit ? { trail: hit.trail, href } : null;
}

/**
 * Where each step of a walk happens: the walk's own page, then wherever a step's `at` moves to, carried on to the
 * steps after it. `fallback` names a page the menu doesn't list (its "Open …" label).
 */
export function docWheres(start: string, ats: (string | undefined)[], fallback?: string): (DocWhere | null)[] {
  const pages = ats.reduce<string[]>((list, at) => [...list, at ?? list[list.length - 1] ?? start], []);
  return pages.map((page) => docWhere(page) ?? (fallback && page === start ? { trail: [fallback.replace(/^Open /, "")], href: start } : null));
}
