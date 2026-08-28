"use client";

import { useEffect, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// From ./constants, not ./queries — this is a client component, and queries.ts is server-only.
import { ACTIVITY_PAGE_SIZE, type LoginEventRow } from "@/lib/loginEvents/constants";
import { LoginActivityTable } from "./login-activity-table";
import { PaginationBar } from "./pagination-bar";

type Outcome = "all" | "success" | "failure";

export function ActivityFeed({
  initialEvents,
  initialTotal,
}: {
  initialEvents: LoginEventRow[];
  initialTotal: number;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [total, setTotal] = useState(initialTotal);
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [page, setPage] = useState(1);
  const isFirstRun = useRef(true);

  useEffect(() => {
    // Page 1 unfiltered is already server-rendered.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const params = new URLSearchParams({ page: String(page) });
    if (outcome !== "all") params.set("outcome", outcome);

    let cancelled = false;
    fetch(`/api/admin/activity?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setEvents(body.events);
        setTotal(body.total);
      });

    return () => {
      cancelled = true;
    };
  }, [outcome, page]);

  return (
    <div className="space-y-4">
      <Select
        value={outcome}
        onValueChange={(v) => {
          setOutcome(v as Outcome);
          setPage(1);
        }}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Outcome" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All attempts</SelectItem>
          <SelectItem value="success">Successful only</SelectItem>
          <SelectItem value="failure">Failed only</SelectItem>
        </SelectContent>
      </Select>

      <LoginActivityTable
        events={events}
        showActor
        footer={
          <PaginationBar
            page={page}
            totalItems={total}
            itemsPerPage={ACTIVITY_PAGE_SIZE}
            itemLabel="attempts"
            onPageChange={setPage}
          />
        }
      />
    </div>
  );
}
