import type { AdminRole } from "@/lib/adminAuth/roles";

/**
 * The Configuration Center is a route registry, not another settings store.
 *
 * Adding a future section means adding one entry here. The dynamic route and the admin shell do
 * not change. `keywords` includes the setting labels that section owns, so the hub search can find
 * a setting before its section has its own implementation.
 */
export const CONFIGURATION_SECTIONS = [
  {
    slug: "payments",
    label: "Payments",
    description: "Providers, modes, keys, and payment health.",
    owner: "SA-4.2",
    icon: "payments",
    keywords: "provider mode sandbox production API key webhook signing secret Whop health",
  },
  {
    slug: "offers",
    label: "Offers & discounts",
    description: "Promotions and automatic discount rules.",
    owner: "SA-4.4",
    icon: "offers",
    keywords: "promotion coupon discount auto apply offer",
  },
  {
    slug: "products",
    label: "Products",
    description: "The product catalog shared by the platform.",
    owner: "SA-4.5",
    icon: "products",
    keywords: "product catalog carrier insurance",
  },
  {
    slug: "templates",
    label: "Templates",
    description: "Lead fields, pipelines, application forms, and reusable question sets.",
    owner: "SA-4.6",
    icon: "templates",
    keywords: "lead fields pipelines forms underwriting questions application",
  },
  {
    slug: "compliance-sources",
    label: "Compliance sources",
    description: "TCPA and Do Not Call vendors and their availability.",
    owner: "SA-4.8",
    icon: "compliance",
    keywords: "TCPA DNC Do Not Call vendor compliance",
  },
  {
    slug: "credits-limits",
    label: "Credits & limits",
    description: "Credit packs, defaults, meters, and usage limits.",
    owner: "SA-4.9",
    icon: "limits",
    keywords: "credits packs defaults usage meters limits",
  },
  {
    slug: "features",
    label: "Features",
    description: "Global feature catalog and kill switches.",
    owner: "SA-4.10",
    icon: "features",
    keywords: "feature kill switch catalog archive",
  },
  {
    slug: "email",
    label: "Email",
    description: "Mail server, sender identity, and templates.",
    owner: "SA-4.11",
    icon: "email",
    keywords: "email mail server sender templates notifications",
  },
  {
    slug: "system",
    label: "System",
    description: "Maintenance mode and platform announcements.",
    owner: "SA-4.12",
    icon: "system",
    keywords: "system maintenance announcement status",
  },
  {
    slug: "advanced",
    label: "Advanced",
    description: "Raw platform settings for values without a more specific home.",
    owner: "SA-4.1",
    icon: "advanced",
    keywords:
      "raw settings key value invitation link lifetime refund approval threshold usage warning threshold default currency",
  },
] as const;

export type ConfigurationSection = (typeof CONFIGURATION_SECTIONS)[number];
export type ConfigurationSectionSlug = ConfigurationSection["slug"];
export type ConfigurationIconKey = ConfigurationSection["icon"];

const SECTION_ACCESS: Record<ConfigurationSectionSlug, readonly AdminRole[]> = {
  // Option 1: live provider credentials and authenticated provider calls stay super_admin-only,
  // preserving SA-4.2's security boundary. Billing admins operate billing records, not secrets.
  payments: ["super_admin"],
  offers: ["super_admin", "billing_admin"],
  products: ["super_admin", "platform_config"],
  templates: ["super_admin", "platform_config"],
  "compliance-sources": ["super_admin", "platform_config"],
  "credits-limits": ["super_admin", "platform_config"],
  features: ["super_admin", "platform_config"],
  email: ["super_admin", "platform_config"],
  system: ["super_admin", "platform_config"],
  advanced: ["super_admin", "platform_config"],
};

export const CONFIGURATION_AUDIT_ACTIONS = [
  "setting.updated",
  "feature.created",
  "feature.updated",
  "coupon.created",
  "coupon.applied",
  "coupon.removed",
  "offer.created",
  "offer.updated",
  "offer.applied",
  "product.created",
  "product.updated",
  "product.archived",
  "product.restored",
  "template.created",
  "template.version_created",
  "template.duplicated",
  "template.archived",
  "template.restored",
  "compliance_vendor.created",
  "compliance_vendor.updated",
  "compliance_vendor.connection_tested",
  "credit_pack.created",
  "credit_pack.updated",
  "credit_pack.archived",
  "credit_pack.purchased",
  "meter_pricing.updated",
  "credit_grant.created",
  "maintenance.updated",
  "announcement.created",
  "announcement.updated",
  "announcement.deleted",
  "plan.created",
  "plan.updated",
  "plan.version_created",
  "plan.deleted",
] as const;

export type ConfigurationAuditAction = (typeof CONFIGURATION_AUDIT_ACTIONS)[number];

const AUDIT_SECTION: Record<ConfigurationAuditAction, ConfigurationSectionSlug> = {
  "setting.updated": "advanced",
  "feature.created": "features",
  "feature.updated": "features",
  "coupon.created": "offers",
  "coupon.applied": "offers",
  "coupon.removed": "offers",
  "offer.created": "offers",
  "offer.updated": "offers",
  "offer.applied": "offers",
  "product.created": "products",
  "product.updated": "products",
  "product.archived": "products",
  "product.restored": "products",
  "template.created": "templates",
  "template.version_created": "templates",
  "template.duplicated": "templates",
  "template.archived": "templates",
  "template.restored": "templates",
  "compliance_vendor.created": "compliance-sources",
  "compliance_vendor.updated": "compliance-sources",
  "compliance_vendor.connection_tested": "compliance-sources",
  "credit_pack.created": "credits-limits",
  "credit_pack.updated": "credits-limits",
  "credit_pack.archived": "credits-limits",
  "credit_pack.purchased": "credits-limits",
  "meter_pricing.updated": "credits-limits",
  "credit_grant.created": "credits-limits",
  "maintenance.updated": "system",
  "announcement.created": "system",
  "announcement.updated": "system",
  "announcement.deleted": "system",
  "plan.created": "products",
  "plan.updated": "products",
  "plan.version_created": "products",
  "plan.deleted": "products",
};

export function getConfigurationSection(slug: string): ConfigurationSection | undefined {
  return CONFIGURATION_SECTIONS.find((section) => section.slug === slug);
}

export function canAccessConfigurationSection(role: AdminRole, slug: ConfigurationSectionSlug): boolean {
  return SECTION_ACCESS[slug].includes(role);
}

export function accessibleConfigurationSections(role: AdminRole): ConfigurationSection[] {
  return CONFIGURATION_SECTIONS.filter((section) => canAccessConfigurationSection(role, section.slug));
}

export function canAccessConfigurationCenter(role: AdminRole): boolean {
  return accessibleConfigurationSections(role).length > 0;
}

export function auditSection(action: string): ConfigurationSectionSlug | null {
  return action in AUDIT_SECTION ? AUDIT_SECTION[action as ConfigurationAuditAction] : null;
}
