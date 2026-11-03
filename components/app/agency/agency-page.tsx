import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { InfoTip } from "@/components/ui/info-tip";
import { agencyStepLabel, type AgencyStep } from "@/lib/agency/steps";

/**
 * Home › Agency's frame (owner 2026-11-03): the agency dashboard, and Producers under it. No rail — a two-step rail
 * spent 200px of the dashboard on one link (owner: "remove this side panel"); Producers is a tile and a strip figure
 * on the dashboard instead, and its pages trail back "Home › Agency › Producers". Each page keeps its own address and
 * its own route's gate (`/app/agency`, `/app/producers`, `/app/producers/<id>`, `/app/producers/invite`).
 *
 * Everything above the page is on the title line: `lead` holds its tabs, `actions` at most two buttons and a More
 * menu, `info` the page's (i). A record (a producer) passes its `title`, its status `chip` and one line of `facts`.
 */
export function AgencyPage({ step, title, info, chip, facts, lead, actions, children }: {
  step: AgencyStep;
  title?: string;
  info?: ReactNode;
  chip?: ReactNode;
  facts?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const shown = title ?? agencyStepLabel(step);
  return (
    <div data-agency-page className="flex min-h-0 w-full min-w-0 flex-grow flex-col gap-4">
      <PageHeader
        title={shown}
        titleInfo={info || chip ? <>{info ? <InfoTip label={`About ${shown}`} side="right">{info}</InfoTip> : null}{chip}</> : undefined}
        // The facts wrap in the title's column, at least 360px wide, so a long line cannot squeeze the tabs at 1280.
        meta={facts ? <p className="mt-1 text-sm text-muted-foreground lg:min-w-[360px] lg:[contain:inline-size]">{facts}</p> : undefined}
        lead={lead}
        actions={actions}
        className="lg:pb-2"
      />
      {children}
    </div>
  );
}
