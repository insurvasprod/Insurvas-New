/**
 * The landing page's one set of sample figures, shared by the hero's dashboard and the True CPA
 * report so the two never disagree. Spend ÷ issued is the CPA each shows. Sample data only.
 */
export const STAGES = ["Bought", "Dialable", "Dialled", "Contacted", "Quoted", "Applied", "Issued"] as const;

export type SampleVendor = { name: string; campaign: string; spend: number; leadCost: number; funnel: readonly number[] };

export const VENDORS: readonly SampleVendor[] = [
  { name: "Cobalt Media", campaign: "Final expense · Facebook", spend: 10234.8, leadCost: 17.06, funnel: [600, 588, 576, 492, 396, 306, 222] },
  { name: "Summit Data", campaign: "Term life · Search", spend: 7800, leadCost: 19.5, funnel: [400, 389, 380, 316, 246, 184, 128] },
  { name: "Bayview Data", campaign: "Final expense · Aged leads", spend: 5856, leadCost: 12.2, funnel: [480, 463, 451, 362, 268, 196, 132] },
  { name: "Northgate Leads", campaign: "Medicare · Social · started this week", spend: 3100, leadCost: 12.4, funnel: [250, 236, 226, 168, 96, 28, 0] },
];

export const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
