"use client";

import { Children, createContext, useContext, useState, type ReactNode } from "react";

import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";

/**
 * Paging for a list that is drawn all at once, server components included: wrap the card in
 * `PagedTableCard` (or the list in `PagedProvider`), swap its `<tbody>` for `<PagedBody>`, and it
 * shows 10 rows a page with the shared Pager in the footer. `total` is the number of rows inside
 * PagedBody. Owner rule, 2026-10-13: no list shows more than 10 rows a page.
 */
const PAGE = 10;

const PagedContext = createContext<{ page: number; setPage: (page: number) => void; pageSize: number } | null>(null);

export function PagedProvider({ pageSize = PAGE, children }: { pageSize?: number; children: ReactNode }) {
  const [page, setPage] = useState(1);
  return <PagedContext.Provider value={{ page, setPage, pageSize: Math.min(pageSize, PAGE) }}>{children}</PagedContext.Provider>;
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

/**
 * A TableCard whose PagedBody is paged. Up to one page the card keeps its own `footer`; past one
 * page the footer is the Pager, with `suffix` after the count.
 */
export function PagedTableCard({ total, noun, suffix, footer, pageSize, ...card }: Omit<Parameters<typeof TableCard>[0], "footer"> & {
  total: number;
  noun: string;
  suffix?: ReactNode;
  footer?: ReactNode;
  pageSize?: number;
}) {
  return (
    <PagedProvider pageSize={pageSize}>
      <TableCard {...card} footer={total > Math.min(pageSize ?? PAGE, PAGE) ? <PagedPager total={total} noun={noun} suffix={suffix} /> : footer} />
    </PagedProvider>
  );
}
