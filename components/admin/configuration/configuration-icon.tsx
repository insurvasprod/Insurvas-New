import {
  CreditCard,
  BadgePercent,
  Boxes,
  FileStack,
  ShieldCheck,
  Gauge,
  ToggleRight,
  Mail,
  Wrench,
  SlidersHorizontal,
} from "lucide-react";

import type { ConfigurationIconKey } from "@/lib/configuration/sections";

// The map lived inside the nav rail. The hub needs the same icons, and two copies of a
// slug-to-icon map is exactly the kind of thing that drifts the first time a section is added.
const ICONS: Record<ConfigurationIconKey, typeof CreditCard> = {
  payments: CreditCard,
  offers: BadgePercent,
  products: Boxes,
  templates: FileStack,
  compliance: ShieldCheck,
  limits: Gauge,
  features: ToggleRight,
  email: Mail,
  system: Wrench,
  advanced: SlidersHorizontal,
};

export function ConfigurationIcon({ icon, className }: { icon: ConfigurationIconKey; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden="true" />;
}
