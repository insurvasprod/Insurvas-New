"use client";

import { useEffect, useState } from "react";

/**
 * LA-2.5-5 · speed to lead per campaign, inside a vendor's row on the roster.
 *
 * "Speed to lead (arrival -> first dial) per vendor/campaign: median and share within 60s." The
 * roster's columns stay per vendor; this adds the vendor's campaigns under its detail, read from
 * GET /api/app/campaigns/speed-to-lead (tenant_campaign_speed_to_lead, measured to the first Dial
 * click). The share is of leads POSTED, so a lead nobody dialled counts against the campaign.
 */

type CampaignSpeed = {
  campaignId: string; campaignName: string; vendorId: string; postedLeads: number; dialledLeads: number;
  medianSeconds: number | null; dialledWithin60s: number; dialledWithin60sPct: number | null;
};
type Loaded = { campaigns: CampaignSpeed[]; pending: boolean };

// One read per page view: every vendor row that opens shares it.
let shared: Promise<Loaded> | null = null;
function load(): Promise<Loaded> {
  shared ??= fetch("/api/app/campaigns/speed-to-lead", { cache: "no-store" })
    .then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load speed to lead");
      return body as Loaded;
    })
    .catch((error: unknown) => { shared = null; throw error; });
  return shared;
}

function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

export function CampaignSpeedToLead({ vendorId }: { vendorId: string }) {
  const [state, setState] = useState<{ loaded: Loaded | null; error: string | null }>({ loaded: null, error: null });
  useEffect(() => {
    let live = true;
    load().then((loaded) => { if (live) setState({ loaded, error: null }); }, (error: unknown) => { if (live) setState({ loaded: null, error: error instanceof Error ? error.message : "Could not load speed to lead" }); });
    return () => { live = false; };
  }, []);

  const rows = state.loaded?.campaigns.filter((row) => row.vendorId === vendorId) ?? [];
  const cell = "border-t border-border px-2 py-1.5 text-xs tabular-nums text-[var(--body)]";
  return (
    <div aria-label="Speed to lead by campaign">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Speed to lead by campaign · arrival to first dial</p>
      {state.error ? <p className="m-0 mt-1 text-xs text-[var(--error-ink)]" role="alert">{state.error}</p>
        : !state.loaded ? <p className="m-0 mt-1 text-xs text-muted-foreground">Loading…</p>
        : state.loaded.pending ? <p className="m-0 mt-1 text-xs text-muted-foreground">Per-campaign speed to lead needs a database update that has not been applied yet.</p>
        : rows.length === 0 ? <p className="m-0 mt-1 text-xs text-muted-foreground">None of this vendor&rsquo;s campaigns has a real-time posted lead yet.</p>
        : <table className="mt-1 w-full border-collapse text-left">
          <thead><tr>
            <th scope="col" className="px-2 py-1 text-xs font-semibold text-muted-foreground">Campaign</th>
            <th scope="col" className="px-2 py-1 text-right text-xs font-semibold text-muted-foreground">Posted</th>
            <th scope="col" className="px-2 py-1 text-right text-xs font-semibold text-muted-foreground">Dialled</th>
            <th scope="col" className="px-2 py-1 text-right text-xs font-semibold text-muted-foreground">Median to dial</th>
            <th scope="col" className="px-2 py-1 text-right text-xs font-semibold text-muted-foreground">Within 60s</th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.campaignId}>
            <td className={`${cell} text-foreground`}>{row.campaignName}</td>
            <td className={`${cell} text-right`}>{row.postedLeads.toLocaleString()}</td>
            <td className={`${cell} text-right`}>{row.dialledLeads.toLocaleString()}</td>
            <td className={`${cell} text-right`}>{duration(row.medianSeconds)}</td>
            <td className={`${cell} text-right`} title={`${row.dialledWithin60s} of ${row.postedLeads} posted leads`}>{row.dialledWithin60sPct === null ? "—" : `${row.dialledWithin60sPct.toFixed(1)}%`}</td>
          </tr>)}</tbody>
        </table>}
    </div>
  );
}
