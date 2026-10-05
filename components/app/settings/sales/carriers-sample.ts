// `?preview=sample` only: the design fixtures in the shape GET /api/app/settings/sales/carriers sends.

import { SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import type { CarriersPayload, SalesCarrierView } from "@/lib/salesSettings/views";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export function sampleCarriers(): CarriersPayload {
  const carriers: SalesCarrierView[] = SALES_CARRIERS.map((c) => {
    const facts = { portalOrigin: c.portalOrigin, referencePattern: c.policyNumberPattern, billingDescriptor: c.billingDescriptor };
    return {
      id: c.id,
      name: c.name,
      platform: facts,
      override: c.platform ? null : facts,
      effective: facts,
      appointment: { activeStates: c.appointment === "appointed" ? ["TX", "OK"] : [], pendingStates: c.appointment === "pending" ? ["TX"] : [] },
      products: c.products.map((p) => ({
        id: p.id, carrierId: c.id, tenantOwned: !c.platform, copiedFromId: null, productCode: "final_expense", name: p.name, tiers: p.tiers,
        issueAgeMin: p.issueAgeMin, issueAgeMax: p.issueAgeMax, faceMinCents: p.faceMinCents, faceMaxCents: p.faceMaxCents,
        bandMin: p.per1000Min.toFixed(2), bandMax: p.per1000Max.toFixed(2), acceptedPaymentMethods: p.paymentMethods, isActive: true,
        termLengths: null, healthClasses: null, examAboveFaceCents: null, convertible: null, conversionDeadlineRule: null, renewalType: null,
      })),
      fieldSet: c.ownFieldSet ? "tenant" : "platform",
      fieldMap: { status: c.fieldMap, version: c.fieldMap === "published" ? 3 : c.fieldMap === "needs_review" ? 2 : null },
      portal: c.portalUsername ? {
        id: `portal-${c.id}`, carrierId: c.id, portalUrl: `${c.portalOrigin}/login`, username: c.portalUsername, writingNumber: "884102", mfaType: "app", notes: null,
        lastVerifiedAt: c.portalVerifiedDaysAgo === null ? null : daysAgo(c.portalVerifiedDaysAgo), needsCheck: c.portalVerifiedDaysAgo === null || c.portalVerifiedDaysAgo > 90,
      } : null,
    };
  });
  return { carriers, addable: [{ id: "car-sample-add", name: "Transamerica" }], productLines: [{ code: "final_expense", name: "Final Expense" }, { code: "term_life", name: "Term Life" }], canEdit: true };
}
