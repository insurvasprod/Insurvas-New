/**
 * Illustrative data for the Home dashboard: the `/design/home` preview (development only) and the
 * view-model tests. Invented names and numbers; nothing here is read from an agency.
 */
import type { HomeToday, DueCallback } from "./homeView.ts";
import type { MoneyFigure } from "./money.ts";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A fixed morning, so the preview and the tests never drift: Wed 28 Oct 2026, 10:40 New York. */
export const SAMPLE_NOW = Date.parse("2026-10-28T14:40:00Z");
export const SAMPLE_ZONE = "America/New_York";

const DIALS = [212, 248, 231, 96, 40, 264, 281, 259, 276, 102, 38, 288, 301, 141];
const REACHED = [71, 88, 79, 30, 11, 96, 104, 92, 101, 33, 12, 109, 118, 52];

function series(scale: number) {
  return DIALS.map((dials, index) => {
    const at = new Date(SAMPLE_NOW - (DIALS.length - 1 - index) * DAY);
    return {
      key: at.toISOString().slice(0, 10),
      label: `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`,
      weekday: WEEKDAYS[at.getUTCDay()],
      dials: Math.round(dials * scale),
      contacts: Math.round(REACHED[index] * scale),
      isToday: index === DIALS.length - 1,
    };
  });
}

const at = (minutesFromNow: number) => new Date(SAMPLE_NOW + minutesFromNow * 60_000).toISOString();

/** The agency's day, as the owner sees it. */
export function sampleToday(scale = 1): HomeToday {
  const s = series(scale);
  return {
    zone: SAMPLE_ZONE,
    dialsToday: s[s.length - 1].dials,
    dialsYesterday: Math.round(118 * scale),
    contactsToday: s[s.length - 1].contacts,
    appointmentsToday: Math.round(9 * scale) || 1,
    appointmentsWeek: Math.round(38 * scale) || 2,
    appointmentsTodayList: [
      { id: "1", customerName: "Maria Hernandez", startsAtUtc: at(35), customerTimezone: "America/Chicago", agentName: "Avery Morgan", status: "booked" },
      { id: "2", customerName: "James O'Connell", startsAtUtc: at(110), customerTimezone: "America/New_York", agentName: "Jordan Lee", status: "confirmed" },
      { id: "3", customerName: "Priya Raman", startsAtUtc: at(200), customerTimezone: "America/Los_Angeles", agentName: "Avery Morgan", status: "booked" },
      { id: "4", customerName: "Linh Nguyen", startsAtUtc: at(320), customerTimezone: "America/Denver", agentName: "Sam Patel", status: "booked" },
    ],
    queueReady: Math.round(186 * scale),
    series: s,
    needs: {
      transfersWaiting: 3,
      slaBreaching: 1,
      slaMinutes: 2,
      oldestWaitingSeconds: 154,
      callbacksOverdue: 2,
      callbacksToday: 5,
      lapsing: 7,
      licences: { expired: 0, expiring: 2, states: ["FL", "TX"] },
    },
    insights: {
      outcomes: [
        { key: "no_answer", label: "No answer", count: 412, contact: false },
        { key: "interested", label: "Interested", count: 188, contact: true },
        { key: "voicemail", label: "Voicemail", count: 171, contact: false },
        { key: "not_interested", label: "Not interested", count: 96, contact: true },
      ],
      heat: { hours: [], days: [], best: { hour: 11, rate: 46.2, dials: 132 }, maxDials: 0 },
      leaders: [
        { userId: "u1", name: "Avery Morgan", dials: 412, contacts: 168 },
        { userId: "u2", name: "Jordan Lee", dials: 366, contacts: 131 },
        { userId: "u3", name: "Sam Patel", dials: 298, contacts: 120 },
        { userId: "u4", name: "Riley Chen", dials: 211, contacts: 74 },
      ],
      sampled: false,
    },
    policies30: { count: 64, premiumCents: 8_426_000 },
    setterWeek: { booked: 23, showed: 15, noShow: 4, closedOut: 19, closeable: 21 },
    closeOut: { showed: 41, noShow: 9, awaiting: 4 },
  };
}

export function sampleCallbacks(): DueCallback[] {
  return [
    { id: "c1", customerName: "Daniel Whitfield", scheduledAtUtc: at(-25), customerTimezone: "America/New_York", isOverdue: true },
    { id: "c2", customerName: "Grace Okafor", scheduledAtUtc: at(-8), customerTimezone: "America/Chicago", isOverdue: true },
    { id: "c3", customerName: "Tomás Rivera", scheduledAtUtc: at(70), customerTimezone: "America/Phoenix", isOverdue: false },
    { id: "c4", customerName: "Helen Brooks", scheduledAtUtc: at(155), customerTimezone: "America/New_York", isOverdue: false },
  ];
}

export function sampleMoney(): MoneyFigure[] {
  return [
    { key: "owed", label: "Owed, not paid", value: "$12,480", caption: "missing, short-paid and wrong chargebacks", tone: "warning", href: "/app/discrepancies" },
    { key: "statements", label: "Statements to review", value: "3", caption: "of 18 statements imported", tone: "warning", href: "/app/statements" },
    { key: "discrepancies", label: "Discrepancies found", value: "14", caption: "open or in a letter", tone: "warning", href: "/app/discrepancies" },
    { key: "exposure", label: "Chargeback exposure", value: "$31,920", caption: "112 policies inside the chargeback window", tone: "warning", href: "/app/ledger?view=expected" },
    { key: "lapse", label: "Lapse risk", value: "7", caption: "$4,310 commission at stake", tone: "danger", href: "/app/lapse-risk?view=signals" },
    { key: "persistency", label: "Persistency · month 9", value: "87%", caption: "412 of 474 still in force", href: "/app/book-scorecards?view=persistency", ring: { value: 412, max: 474, label: "412 of 474 policies in force at month 9" } },
  ];
}
