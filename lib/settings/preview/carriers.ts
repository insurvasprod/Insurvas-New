/**
 * Sample answers for Settings › Carriers in the preview (settings-redesign R2). Built from the design
 * fixtures in lib/applications/settingsFixtures.ts so the carriers match the Sales panels' samples.
 * Ticks and switches change this in-memory sample only; nothing reaches a real API.
 */
import { SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import type { AppointmentRow, LicenseRow } from "@/lib/appointments/service-types";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import type { CarriersPayload, SalesCarrierView } from "@/lib/salesSettings/views";

const TENANT = "tenant-preview";
const STAMP = "2026-09-01T12:00:00Z";
const daysAgo = (days: number) => new Date(Date.parse("2026-10-28T16:00:00Z") - days * 86_400_000).toISOString();

/** The platform library: the five sample carriers and two the agency has not added. */
const LIBRARY = [...SALES_CARRIERS.map((c) => ({ id: c.id, name: c.name })), { id: "car-transamerica", name: "Transamerica" }, { id: "car-royal", name: "Royal Neighbors of America" }];

/** Added by the agency; Corebridge is added but switched off. */
const ADDED = ["car-mutual", "car-aetna", "car-americo", "car-foresters", "car-corebridge"];

const tenantCarriers: TenantCarrierRow[] = ADDED.filter((id) => id !== "car-americo").map((carrier_id, index) => ({
  id: `tc-${carrier_id}`, tenant_id: TENANT, carrier_id, contract_level_bp: [11000, 10000, 9500, 9000][index] ?? 9000,
  writing_number: ["MO-44821", "AE-20931", "FR-77102", "CB-11893"][index] ?? "", effective_from: "2026-01-01", is_active: true, created_at: STAMP,
}));

let requirements = ADDED.map((carrier_id) => ({ carrier_id, contracted: carrier_id !== "car-corebridge" }));

const appointment = (carrier_id: string, state: string, status: AppointmentRow["status"] = "active"): AppointmentRow => ({
  id: `ap-${carrier_id}-${state}`, tenant_id: TENANT, carrier_id, state, status, effective_from: "2026-02-01", terminated_at: null, created_at: STAMP, updated_at: STAMP, expires_at: null,
});

let appointments: AppointmentRow[] = [
  // 23 states, as a real agency has: enough that the States tab pages (owner's screen, 2026-10-29).
  ...["TX", "GA", "AL", "FL", "TN", "AK", "AZ", "CA", "CO", "CT", "DC", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "MI", "OH", "PA", "VA"].map((s) => appointment("car-mutual", s)),
  ...["TX", "GA", "FL"].map((s) => appointment("car-aetna", s)),
  appointment("car-americo", "TX", "pending"),
  ...["TX", "GA"].map((s) => appointment("car-foresters", s)),
];

const licence = (state: string, number: string, expires: string): LicenseRow => ({
  id: `li-${state}`, tenant_id: TENANT, state, license_number: number, expires_at: expires, created_at: STAMP, updated_at: STAMP, licence_type: state === "TX" ? "resident" : "non_resident", lines_of_authority: ["Life", "Accident & Health"],
});

let licenses: LicenseRow[] = [licence("TX", "2384761", "2027-06-30"), licence("GA", "LIC-9921", "2026-11-20"), licence("AL", "AL-551023", "2027-03-31"), licence("FL", "W118273", "2027-01-31"), licence("TN", "", "")];

function vault() {
  return { carriers: LIBRARY, tenantCarriers, appointments, licenses, extendedFields: true, carrierRequirements: requirements };
}

function salesCarriers(): CarriersPayload {
  const carriers: SalesCarrierView[] = SALES_CARRIERS.map((c) => {
    const facts = { portalOrigin: c.portalOrigin, referencePattern: c.policyNumberPattern, billingDescriptor: c.billingDescriptor };
    const mine = appointments.filter((row) => row.carrier_id === c.id);
    return {
      id: c.id, name: c.name, platform: facts, override: c.platform ? null : facts, effective: facts,
      appointment: { activeStates: mine.filter((r) => r.status === "active").map((r) => r.state), pendingStates: mine.filter((r) => r.status === "pending").map((r) => r.state) },
      products: c.products.map((p) => ({
        id: p.id, carrierId: c.id, tenantOwned: !c.platform, copiedFromId: null, productCode: "final_expense", name: p.name, tiers: p.tiers,
        issueAgeMin: p.issueAgeMin, issueAgeMax: p.issueAgeMax, faceMinCents: p.faceMinCents, faceMaxCents: p.faceMaxCents,
        bandMin: p.per1000Min.toFixed(2), bandMax: p.per1000Max.toFixed(2), acceptedPaymentMethods: p.paymentMethods, isActive: true,
        termLengths: null, healthClasses: null, examAboveFaceCents: null, convertible: null, conversionDeadlineRule: null, renewalType: null,
      })),
      fieldSet: c.ownFieldSet ? "tenant" : "platform",
      fieldMap: { status: c.fieldMap, version: c.fieldMap === "none" ? null : 1 },
      portal: c.portalUsername ? {
        id: `pa-${c.id}`, carrierId: c.id, portalUrl: c.portalOrigin, username: c.portalUsername, writingNumber: null, mfaType: "app", notes: null,
        lastVerifiedAt: c.portalVerifiedDaysAgo === null ? null : daysAgo(c.portalVerifiedDaysAgo), needsCheck: (c.portalVerifiedDaysAgo ?? 999) > 90,
      } : null,
    };
  });
  return {
    carriers, addable: LIBRARY.filter((c) => !ADDED.includes(c.id)),
    productLines: [{ code: "final_expense", name: "Final Expense", sold: true }, { code: "term_life", name: "Term Life", sold: true }],
    canEdit: true,
  };
}

type Answer = { status: number; body: unknown };
type State = "loaded" | "empty" | "error" | "readonly";
const ok = (body: unknown): Answer => ({ status: 200, body });

export const CARRIER_HANDLERS: Record<string, (state: State, body: unknown) => Answer> = {
  "GET /api/app/appointment-vault": (state) => (state === "error"
    ? { status: 500, body: { error: "Could not load your carriers. (Sample error.)" } }
    : ok(state === "empty" ? { ...vault(), tenantCarriers: [], appointments: [], licenses: [], carrierRequirements: [] } : vault())),
  "GET /api/app/settings/sales/carriers": (state) => ok({ ...salesCarriers(), canEdit: state !== "readonly" }),
  "POST /api/app/settings/sales/carriers": () => ok({ ok: true }),
  "POST /api/app/carrier-library/tenant-carriers": () => ok({ ok: true }),
  "GET /api/app/field-maps": () => ok({ maps: [], carriers: SALES_CARRIERS.map((c) => ({ id: c.id, name: c.name, portalOrigin: c.portalOrigin, products: c.products.map((p) => ({ id: p.id, name: p.name })) })) }),
  "POST /api/app/appointment-vault/appointments": (_state, body) => {
    for (const change of (body as { appointments?: { carrier_id: string; state: string; status?: AppointmentRow["status"] }[] } | null)?.appointments ?? []) {
      appointments = appointments.filter((row) => !(row.carrier_id === change.carrier_id && row.state === change.state));
      if (change.status !== "terminated") appointments.push(appointment(change.carrier_id, change.state, change.status ?? "active"));
    }
    return ok({ ok: true });
  },
  "POST /api/app/appointment-vault/licenses": (_state, body) => {
    const state = (body as { state?: string } | null)?.state;
    if (state && !licenses.some((row) => row.state === state)) licenses = [...licenses, licence(state, "", "")];
    return ok({ ok: true });
  },
  "PATCH /api/app/carrier-library/tenant-carriers": (_state, body) => {
    const change = body as { carrier_id?: string; contracted?: boolean } | null;
    if (change?.carrier_id) requirements = [...requirements.filter((row) => row.carrier_id !== change.carrier_id), { carrier_id: change.carrier_id, contracted: Boolean(change.contracted) }];
    return ok({ ok: true });
  },
};
