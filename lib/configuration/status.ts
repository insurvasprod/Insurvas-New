import "server-only";

// The hub's job is telling you WHERE TO GO. Before this, every section card looked identical, so
// the hub could not do its one job — you had to open each area to find out whether it needed you.
//
// Each section resolves to a short status: a tone, a badge, and one line of detail. Anything that
// cannot be read degrades to "unknown" rather than throwing, because a broken status must not take
// down the page that lists every other section.

import { getProviderStatus } from "@/lib/payments/status";
import { fetchOffers } from "@/lib/offers/queries";
import { fetchProducts } from "@/lib/products/queries";
import { fetchTemplates } from "@/lib/templates/queries";
import { listComplianceVendors, getDncDialingStatus } from "@/lib/compliance/service";
import { listMeterPricing, listUsageMonitor } from "@/lib/creditsLimits/service";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { fetchFeatureCatalog } from "@/lib/features/queries";
import { getAllSettings } from "@/lib/settings/queries";
import type { ConfigurationSectionSlug } from "./sections";

/** `attention` is the only tone that pulls a section into the banner at the top of the hub. */
export type StatusTone = "neutral" | "good" | "attention" | "unknown";

export type SectionStatus = {
  tone: StatusTone;
  /** Short pill. Null renders no pill at all rather than an empty one. */
  badge: string | null;
  /** One line under the section name. Says what is true, not what the section is for. */
  detail: string;
};

export type ConfigurationOverview = Record<string, SectionStatus>;

const UNKNOWN: SectionStatus = { tone: "unknown", badge: null, detail: "Could not be read just now." };

/** Every status is independent — one failing must not blank the rest of the hub. */
async function safe(load: () => Promise<SectionStatus>): Promise<SectionStatus> {
  try {
    return await load();
  } catch (error) {
    console.error("[configuration] a section status could not be read", error);
    return UNKNOWN;
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export async function getConfigurationOverview(): Promise<ConfigurationOverview> {
  const [payments, offers, products, templates, compliance, credits, features, settings] = await Promise.all([
    safe(async () => {
      const status = await getProviderStatus();
      if (status.mode === "unknown") {
        return { tone: "attention", badge: "Not configured", detail: "No Whop host is set, so payments cannot run." };
      }
      const failures = status.health.failures24h;
      return {
        // Production is not a problem — but it IS the thing to notice, so it never reads as "good".
        tone: failures > 0 ? "attention" : "neutral",
        badge: status.mode === "production" ? "Production" : "Sandbox",
        detail: failures > 0 ? `${plural(failures, "failure")} in the last 24 hours.` : "Answering normally.",
      };
    }),

    safe(async () => {
      const all = await fetchOffers();
      const active = all.filter((o) => o.is_active);
      return {
        tone: "neutral",
        badge: active.length > 0 ? `${active.length} active` : null,
        detail: all.length === 0 ? "No offers yet." : `${plural(all.length, "offer")} in total.`,
      };
    }),

    safe(async () => {
      const all = await fetchProducts({ includeArchived: false });
      return { tone: "neutral", badge: null, detail: plural(all.length, "product") + " available." };
    }),

    safe(async () => {
      const all = await fetchTemplates({ includeArchived: false });
      return {
        tone: all.length === 0 ? "attention" : "neutral",
        badge: null,
        detail: all.length === 0 ? "None — new agents land in an empty workspace." : plural(all.length, "template") + " available.",
      };
    }),

    safe(async () => {
      const [vendors, dialing] = await Promise.all([listComplianceVendors(), getDncDialingStatus()]);
      const enabled = vendors.filter((v) => v.is_enabled).length;
      // The one rule in SA-4.8 that must not bend: no DNC vendor means no dialing, platform-wide.
      const blocked = dialing.blocked;
      return {
        tone: blocked ? "attention" : enabled > 0 ? "good" : "neutral",
        badge: blocked ? "Dialing blocked" : enabled > 0 ? `${enabled} live` : null,
        detail: blocked ? "No DNC vendor is reachable, so nobody can dial." : "DNC scrub healthy — dialing allowed.",
      };
    }),

    safe(async () => {
      const [pricing, over80] = await Promise.all([listMeterPricing(), listUsageMonitor(true)]);
      const belowCost = pricing.filter((m) => m.sell_cents > 0 && m.sell_cents <= m.cost_cents).length;
      return {
        tone: belowCost > 0 ? "attention" : "neutral",
        badge: belowCost > 0 ? `${belowCost} below cost` : null,
        detail:
          over80.length > 0
            ? `${plural(pricing.length, "meter")} · ${over80.length} tenant${over80.length === 1 ? "" : "s"} over 80%.`
            : plural(pricing.length, "meter") + " priced.",
      };
    }),

    safe(async () => {
      const [switches, groups] = await Promise.all([fetchAllSwitches(), fetchFeatureCatalog({ includeArchived: false })]);
      const total = groups.reduce((n, g) => n + g.features.length, 0);
      const notOn = [...switches.values()].filter((s) => s.state !== "on");
      return {
        tone: notOn.length > 0 ? "attention" : "good",
        badge: notOn.length > 0 ? `${notOn.length} switched off` : "All on",
        detail:
          notOn.length > 0
            ? `${plural(total, "feature")} · ${notOn.map((s) => s.feature_key).slice(0, 2).join(", ")}${notOn.length > 2 ? "…" : ""}`
            : `${plural(total, "feature")} · no kill switches active.`,
      };
    }),

    safe(async () => {
      const all = await getAllSettings();
      const overridden = all.filter((s) => s.isOverridden).length;
      return {
        tone: "neutral",
        badge: null,
        detail: `${plural(all.length, "value")}${overridden > 0 ? `, ${overridden} changed from the default` : ""}.`,
      };
    }),
  ]);

  const overview: Record<ConfigurationSectionSlug, SectionStatus> = {
    payments,
    offers,
    products,
    templates,
    "compliance-sources": compliance,
    "credits-limits": credits,
    features,
    // SA-4.11 and SA-4.12 are not built. Saying so is more useful than an empty card that looks
    // like it might work.
    email: { tone: "attention", badge: "Not set up", detail: "No provider — invitations are not being sent." },
    system: { tone: "neutral", badge: null, detail: "No maintenance scheduled." },
    advanced: settings,
  };

  return overview;
}
