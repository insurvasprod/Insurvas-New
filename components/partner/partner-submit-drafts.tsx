"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, RotateCcw } from "lucide-react";

import { st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLoading } from "@/components/ui/page-states";
import { cardSurface } from "@/components/ui/card";
import { Pager } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { agoLabel } from "@/lib/format/ago";
import { productLineLabel } from "@/lib/format/productLine";

const PAGE_SIZE = 20;

type Draft = {
  id: string;
  product_code: string;
  carrier_state: string | null;
  label: string | null;
  phone_last4: string | null;
  answered: number;
  pause_reason: string | null;
  pause_notes: string | null;
  updated_at: string;
};

type DraftPage = { drafts: Draft[]; page: number; pageCount: number; total: number; pageSize: number };

export function PartnerSubmitDrafts() {
  const [data, setData] = useState<DraftPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    void fetch(`/api/partner/drafts?page=${page}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as (DraftPage & { error?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.error ?? "Could not load drafts");
        if (active) setData(body);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load drafts"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, reload]);

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-5">
      <PageHeader
        title="Saved drafts"
        description="Pick up a lead application where you left off. Your changes save automatically."
        breadcrumbs={[{ label: "Submit New Lead", href: "/partner/submit-lead" }, { label: "Drafts" }]}
        actions={<Button asChild variant="outline"><Link href="/partner/submit-lead"><ArrowLeft aria-hidden="true" />Back to form</Link></Button>}
      />
      {!data && !error ? <div className={`${cardSurface} flex-1`}><SectionLoading rows={6} columns={5} label="Loading saved drafts" /></div> : error ? (
        <div className={`${cardSurface} grid min-h-60 flex-1 place-content-center gap-2 text-center`} role="alert">
          <h2 className="font-semibold text-[var(--ink)]">Drafts could not be loaded</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" className="mx-auto" onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1); }}>Try again</Button>
        </div>
      ) : (
        <TableCard
          title="Your drafts"
          description="Resume any saved application. Your answers and screening status are kept with each draft."
          info="Drafts are private to your account and saved automatically as you complete the form."
          action={<span className="text-sm text-muted-foreground">{data?.total ?? 0} {data?.total === 1 ? "draft" : "drafts"}</span>}
          bodyClassName="min-h-0 flex-1"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          footer={<Pager page={data?.page ?? page} total={data?.total ?? 0} pageSize={PAGE_SIZE} noun="drafts" onPage={(nextPage) => { setError(null); setLoading(true); setPage(nextPage); }} disabled={loading} />}
        >
          {!data || loading ? <SectionLoading rows={6} columns={5} label="Loading saved drafts" /> : (
            <table className={`${st.table} h-full min-h-full min-w-[960px]`}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={`${st.th} w-[240px]`}>Customer</th>
                  <th scope="col" className={`${st.th} w-[170px]`}>Product</th>
                  <th scope="col" className={`${st.th} w-[120px]`}>State</th>
                  <th scope="col" className={`${st.th} w-[150px]`}>Progress</th>
                  <th scope="col" className={`${st.th} w-[150px]`}>Last saved</th>
                  <th scope="col" className={`${st.th} w-[130px] text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="m-seq h-full">
                {data.drafts.map((draft) => (
                  <tr key={draft.id} className="m-row hover:bg-[var(--surface-alt)]">
                    <td className={`${st.td} max-w-[240px]`}>
                      <span className="block truncate font-semibold text-[var(--ink)]" title={draft.label ?? undefined}>{draft.label ?? "Customer details not entered yet"}</span>
                      <span className={st.sub}>{draft.phone_last4 ? `Phone ending ${draft.phone_last4}` : "Phone not added"}{draft.pause_reason ? ` · Paused: ${draft.pause_reason}` : ""}</span>
                    </td>
                    <td className={st.td}>{productLineLabel(draft.product_code)}</td>
                    <td className={st.td}>{draft.carrier_state ?? "—"}</td>
                    <td className={st.td}>{draft.answered} {draft.answered === 1 ? "answer" : "answers"}</td>
                    <td className={`${st.td} whitespace-nowrap`}>{agoLabel(Date.parse(draft.updated_at), now)}</td>
                    <td className={`${st.td} text-right`}>
                      <Button asChild size="sm"><Link href={`/partner/submit-lead?draft_id=${encodeURIComponent(draft.id)}`}><RotateCcw aria-hidden="true" />Resume</Link></Button>
                    </td>
                  </tr>
                ))}
                {data.drafts.length === 0 && (
                  <tr>
                    <td colSpan={6} className={`${st.td} h-72 text-center align-middle`}>
                      <div className="mx-auto grid max-w-md justify-items-center gap-2">
                        <FileText aria-hidden="true" className="size-8 text-muted-foreground" />
                        <h3 className="font-semibold text-[var(--ink)]">No saved drafts yet</h3>
                        <p className="text-sm text-muted-foreground">Start a lead application and your progress will save automatically.</p>
                        <Button asChild className="mt-2"><Link href="/partner/submit-lead">Start a lead</Link></Button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </TableCard>
      )}
    </section>
  );
}
