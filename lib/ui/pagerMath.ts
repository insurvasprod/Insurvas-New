// The pager's arithmetic (components/ui/pager.tsx), pure and client-safe so it can be tested.

/**
 * The page numbers to draw: every page when there are seven or fewer, otherwise the first, the
 * last, the current one with its neighbours, and a gap wherever pages are skipped.
 */
export function pageItems(current: number, pages: number): Array<number | "gap"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const near = new Set([1, pages, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => near.add(n));
  if (current >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => near.add(n));
  const sorted = [...near].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) out.push(n - sorted[index - 1] === 2 ? n - 1 : "gap");
    out.push(n);
  });
  return out;
}

/** An address with its `page` set: "?tab=activity" → "?tab=activity&page=3"; page 1 drops the parameter. */
export function withPage(href: string, page: number): string {
  const at = href.indexOf("?");
  const path = at < 0 ? href : href.slice(0, at);
  const params = new URLSearchParams(at < 0 ? "" : href.slice(at + 1));
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  const query = params.toString();
  return `${path}${query ? `?${query}` : path ? "" : "?"}`;
}
