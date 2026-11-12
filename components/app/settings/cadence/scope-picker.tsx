"use client";

/**
 * Settings › Dialing cadence · "Applies to" (round 8, board A "Pick a scope"). Says what each campaign
 * runs: the agency cadence, or its own with its number of calls. Picking "Every campaign" or a
 * campaign with its own cadence edits that cadence here; picking a campaign on the agency cadence
 * opens the campaign sheet, where it can be given its own.
 */

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

export type ScopeCampaign = { id: string; name: string; own: { calls: number } | null };

export function ScopePicker({
  campaignId,
  campaigns,
  agency,
  disabled,
  onPick,
  onOverride,
}: {
  campaignId: string;
  campaigns: ScopeCampaign[];
  /** The agency cadence: whether it is the agency's own or the Insurvas default, and its calls. */
  agency: { own: boolean; calls: number };
  disabled?: boolean;
  /** Edit this scope here ("" = every campaign). */
  onPick: (campaignId: string) => void;
  /** Open the campaign sheet ("" = choose a campaign there). */
  onOverride: (campaignId: string) => void;
}) {
  const current = campaigns.find((campaign) => campaign.id === campaignId);
  const chip = current
    ? current.own ? <StatusChip tone="info">Own</StatusChip> : <StatusChip tone="neutral">Agency</StatusChip>
    : agency.own ? <StatusChip tone="good">Yours</StatusChip> : <StatusChip tone="info" dot={false}>Insurvas default</StatusChip>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="max-w-[340px] font-normal" aria-label={`Applies to: ${current?.name ?? "Every campaign"}`}>
          <span className="text-[var(--muted)]">Applies to</span>
          <span className="truncate font-medium text-[var(--ink)]">{current?.name ?? "Every campaign"}</span>
          {chip}
          <ChevronDown aria-hidden="true" className="text-[var(--muted)]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px]">
        <DropdownMenuItem onSelect={() => onPick("")} className={cn("justify-between", !campaignId && "bg-[var(--hover-wash)]")}>
          <span>Every campaign</span>
          <StatusChip tone={agency.own ? "good" : "info"} dot={agency.own}>{agency.own ? "Yours" : "Insurvas default"} · {agency.calls} calls</StatusChip>
        </DropdownMenuItem>
        {campaigns.length > 0 && <DropdownMenuSeparator />}
        {campaigns.map((campaign) => (
          <DropdownMenuItem
            key={campaign.id}
            onSelect={() => (campaign.own ? onPick(campaign.id) : onOverride(campaign.id))}
            className={cn("justify-between gap-3", campaign.id === campaignId && "bg-[var(--hover-wash)]")}
          >
            <span className="truncate">{campaign.name}</span>
            {campaign.own ? <StatusChip tone="info">Own · {campaign.own.calls} calls</StatusChip> : <span className="shrink-0 text-xs text-[var(--muted)]">Agency cadence</span>}
          </DropdownMenuItem>
        ))}
        {campaigns.some((campaign) => !campaign.own) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onOverride("")} className="font-medium text-[var(--accent-ink)]">Give a campaign its own cadence…</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
