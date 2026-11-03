"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { BoardTableFooter } from "@/components/admin/board-table-footer";

/**
 * The Audit tab's footer. The tab is server-rendered, so paging is a navigation to `?tab=audit&page=`
 * rather than a client fetch; this island only turns Previous / Next into that navigation.
 */
export function UserDetailPager({
  baseHref,
  page,
  pageSize,
  total,
  itemLabel,
  order,
}: {
  baseHref: string;
  page: number;
  pageSize: number;
  total: number;
  itemLabel: string;
  order: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <BoardTableFooter
      page={page}
      pageSize={pageSize}
      total={total}
      itemLabel={itemLabel}
      order={order}
      busy={pending}
      onPageChange={(next) =>
        startTransition(() => router.push(next <= 1 ? baseHref : `${baseHref}&page=${next}`, { scroll: false }))
      }
    />
  );
}
