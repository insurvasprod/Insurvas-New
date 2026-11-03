"use client";

import { Children, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { fillLine } from "@/components/ui/table-card-layout";
import { MAX_ROWS } from "@/components/ui/use-fitting-page-size";

/**
 * Paging for a list that is drawn all at once, server components included: wrap the card in
 * `PagedTableCard` (or the list in `PagedProvider`), swap its `<tbody>` for `<PagedBody>`, and it
 * shows a page of rows with the shared Pager in the footer. `total` is the number of rows inside
 * PagedBody.
 *
 * How many rows a page holds (owner 2026-11-02, the table foundation): a PagedTableCard that is the
 * last thing on its page shows exactly as many rows as fit above the screen's foot, with the pager on
 * that line; anywhere else (a dialog, a second list) a page is 10 rows.
 */
const PAGE = 10;

const PagedContext = createContext<{ page: number; setPage: (page: number) => void; pageSize: number } | null>(null);

export function PagedProvider({ pageSize = PAGE, children }: { pageSize?: number; children: ReactNode }) {
  const [page, setPage] = useState(1);
  const size = Math.max(1, Math.min(pageSize, MAX_ROWS));
  return <PagedContext.Provider value={{ page, setPage, pageSize: size }}>{children}</PagedContext.Provider>;
}

/** The rows of the current page. Renders a `<tbody>` unless `as` says otherwise (`ul`, `ol`, `div`). */
export function PagedBody({ as: Tag = "tbody", className, children }: { as?: "tbody" | "ul" | "ol" | "div"; className?: string; children: ReactNode }) {
  const paged = useContext(PagedContext);
  const rows = Children.toArray(children);
  const shown = paged ? paginate(rows, paged.page, paged.pageSize).rows : rows;
  return <Tag className={className}>{shown}</Tag>;
}

/** The Pager for the surrounding PagedProvider; draws nothing when every row fits one page. */
export function PagedPager({ total, noun, suffix }: { total: number; noun: string; suffix?: ReactNode }) {
  const paged = useContext(PagedContext);
  if (!paged || total <= paged.pageSize) return null;
  return <Pager page={paginate(Array.from({ length: total }), paged.page, paged.pageSize).current} total={total} pageSize={paged.pageSize} noun={noun} suffix={suffix} onPage={paged.setPage} />;
}

/** The pager row's height before it is drawn (the footer's 10px padding twice and a 36px pager). */
const PAGER_ROW = 57;

/**
 * Rows that fit this card: from where its rows start down to the line it fills to, less the pager's
 * row. Measured from the rows on screen (a two-line row counts as one); grows only from a full page, so
 * rows of different heights never flip the size back and forth. `fallback` when the card is not the
 * page's last block or has no rows yet.
 */
function useCardPageSize(holder: React.RefObject<HTMLDivElement | null>, total: number, fallback: number) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const measure = (current: number) => {
      const card = holder.current?.querySelector<HTMLElement>('[data-slot="table-card"]');
      const body = card?.querySelector<HTMLElement>("tbody, [data-paged-body]");
      if (!card || !body) return current;
      const line = fillLine(card);
      if (line === null) return fallback;
      const rows = [...body.children].map((row) => (row as HTMLElement).offsetHeight).filter(Boolean);
      if (!rows.length) return current;
      const each = rows.reduce((sum, height) => sum + height, 0) / rows.length;
      const footer = card.lastElementChild && !card.lastElementChild.contains(body) ? (card.lastElementChild as HTMLElement).offsetHeight : 0;
      // The pager's row is there whenever there is more than one page.
      const room = line - body.getBoundingClientRect().top - Math.max(footer, total > rows.length ? PAGER_ROW : 0) - 2;
      const fits = Math.max(3, Math.min(MAX_ROWS, Math.floor(room / each)));
      if (rows.length < current && fits >= rows.length) return current; // a short last page leaves room on purpose
      return fits;
    };
    let frame = 0;
    const fit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setSize((current) => measure(current))); };
    fit();
    const sizes = new ResizeObserver(fit);
    const main = document.querySelector("main");
    if (main) sizes.observe(main);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(frame); sizes.disconnect(); window.removeEventListener("resize", fit); };
  }, [holder, total, fallback]);
  return size;
}

/**
 * A TableCard whose PagedBody is paged. Up to one page the card keeps its own `footer`; past one
 * page the footer is the Pager, with `suffix` after the count. `pageSize` fixes the page instead of
 * fitting it to the screen.
 */
export function PagedTableCard({ total, noun, suffix, footer, pageSize, ...card }: Omit<Parameters<typeof TableCard>[0], "footer"> & {
  total: number;
  noun: string;
  suffix?: ReactNode;
  footer?: ReactNode;
  pageSize?: number;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const fitted = useCardPageSize(holder, total, PAGE);
  const size = pageSize ?? fitted;
  return (
    <div ref={holder} className="contents">
      <PagedProvider pageSize={size}>
        <TableCard {...card} footer={total > size ? <PagedPager total={total} noun={noun} suffix={suffix} /> : footer} />
      </PagedProvider>
    </div>
  );
}
