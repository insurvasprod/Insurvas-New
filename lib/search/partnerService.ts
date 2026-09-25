import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { stageNames, type SearchHit } from "./service";

/**
 * Partner search.
 *
 * The narrowest of the three, and the one whose scope matters most: a partner sees leads their own
 * organisation submitted and nothing else. Both `tenant_id` and `partner_id` are in the query, not
 * applied afterwards — the same rule as the tenant search, for the same reason.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

const PAGES: { title: string; meta: string; href: string }[] = [
  { title: "Overview", meta: "What you have sent, and what happened to it", href: "/partner" },
  { title: "Submit a lead", meta: "The form your team fills", href: "/partner/submit-lead" },
  { title: "Pipeline", meta: "Where your submitted leads reached", href: "/partner/pipeline" },
  { title: "Messages", meta: "Your channel with the agency", href: "/partner/messages" },
  { title: "Team review", meta: "What your submitters sent, by person", href: "/partner/team-review" },
  { title: "Team access", meta: "Invite and manage your own teammates", href: "/partner/team" },
  { title: "Settings", meta: "Your organisation's details", href: "/partner/settings" },
];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function searchPartner(input: { tenantId: string; partnerId: string; query: string; limit?: number }) {
  const term = input.query.replace(/\s+/g, " ").trim();
  if (term.length < 2) return { hits: [], total: 0, truncated: false };
  // Same reserved characters as the tenant search: `,()"\` are syntax inside .or().
  const like = `*${term.replace(/[*%,()"\\]/g, " ")}*`;
  const needle = term.toLowerCase();

  let leads: SearchHit[] = [];
  try {
    const { data, error } = await db()
      .from("agent_leads")
      .select("id, values, product_line, stage_id, created_at")
      .eq("tenant_id", input.tenantId)
      .eq("partner_id", input.partnerId)
      .or([
        `values->>first_name.ilike.${like}`,
        `values->>last_name.ilike.${like}`,
        `values->>full_name.ilike.${like}`,
        `values->>phone.ilike.${like}`,
      ].join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; values: Record<string, unknown> | null; product_line: string | null; stage_id: string | null; created_at: string }[];
    const stages = await stageNames(input.tenantId, rows.map((row) => row.stage_id));
    leads = rows.map((row) => {
      const values = (row.values ?? {}) as Record<string, unknown>;
      const name = text(values.full_name) || [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") || "Unnamed lead";
      return {
        group: "Your leads" as const,
        title: name,
        // Stage only — a partner is told where their lead reached, never what it cost or who owns it.
        meta: [row.product_line?.replace(/_/g, " "), row.stage_id ? stages.get(row.stage_id) : null, new Date(row.created_at).toLocaleDateString()].filter(Boolean).join(" · "),
        href: "/partner/pipeline",
      } as SearchHit;
    });
  } catch {
    leads = [];
  }

  const pages: SearchHit[] = PAGES
    .filter((page) => page.title.toLowerCase().includes(needle) || page.meta.toLowerCase().includes(needle))
    .slice(0, 4)
    .map((page) => ({ group: "Pages", title: page.title, meta: page.meta, href: page.href }));

  const ranked = [...leads, ...pages];
  const limit = Math.min(20, Math.max(1, input.limit ?? 7));
  return { hits: ranked.slice(0, limit), total: ranked.length, truncated: ranked.length > limit };
}
