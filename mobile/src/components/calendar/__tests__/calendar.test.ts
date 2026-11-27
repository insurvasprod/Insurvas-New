import type { CallbackView } from "@/lib/types";
import { addressLines, appointmentMeta, appointmentWhen, directionsUrl, setterLine } from "../appointment";
import { calendarItems, dotsByDay, itemMeta, longDay, monthGrid, monthRange, monthTitle, type CalendarAppointment } from "../month";
import { bookableAgents, hoursAhead, openSlots, type BookableContext } from "../slots";
import { slotLabel, zoneLine } from "../book-appointment";

jest.mock("@/lib/session", () => ({ useSession: () => ({ api: jest.fn() }) }));

const NY = "America/New_York";
const NOW = Date.parse("2026-11-24T15:00:00Z"); // Tue 24 Nov, 10:00 am in New York

const cb = (over: Partial<CallbackView>): CallbackView => ({
  id: "cb", leadId: "l", workItemId: null, customerName: "Maria Alvarez", scheduledAtUtc: "2026-11-24T14:30:00Z", customerTimezone: "America/Chicago",
  customerTime: null, agentTime: null, assignedTo: "me", assigneeName: "Me", note: null, status: "scheduled", productName: null, phone: null, state: "TX",
  attemptNumber: null, isOverdue: false, isDueToday: true, ...over,
});
const appt = (over: Partial<CalendarAppointment>): CalendarAppointment => ({
  appointmentId: "a", leadId: "l2", customerName: "Patricia Moore", agentUserId: "me", agentName: "Ava Kim", startsAtUtc: "2026-11-24T19:00:00Z",
  durationMinutes: 60, customerTimezone: NY, status: "booked", notes: null, bookedByUserId: "setter", bookedByName: "Lena Park", product: "Final expense", ...over,
});

test("the month is whole weeks, Monday first, and one month is one API range", () => {
  const cells = monthGrid(2026, 11);
  expect(cells.length % 7).toBe(0);
  expect(cells[0]).toEqual({ key: "2026-10-26", num: 26, inMonth: false });
  expect(cells.find((c) => c.key === "2026-11-01")?.inMonth).toBe(true);
  const { from, to } = monthRange(2026, 11, NY);
  expect(from).toBe("2026-11-01T04:00:00.000Z");
  expect(to).toBe("2026-12-01T05:00:00.000Z");
  expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBeLessThanOrEqual(31);
  expect(monthTitle(2026, 11)).toBe("November 2026");
  expect(longDay("2026-11-24")).toBe("Tuesday 24 November");
});

test("callbacks and appointments merge: overdue is orange, done is green, cancelled is gone", () => {
  const items = calendarItems(
    [cb({ id: "late", isOverdue: true }), cb({ id: "done", status: "completed", scheduledAtUtc: "2026-11-24T16:30:00Z" }), cb({ id: "gone", status: "cancelled" })],
    [appt({}), appt({ appointmentId: "moved", status: "rescheduled" }), appt({ appointmentId: "past", startsAtUtc: "2026-11-23T15:00:00Z" })],
    NY, NOW,
  );
  expect(items.map((i) => i.id)).toEqual(["past", "late", "done", "a"]);
  expect(items.find((i) => i.id === "late")).toMatchObject({ tone: "late", chip: "Overdue" });
  expect(items.find((i) => i.id === "done")).toMatchObject({ tone: "done", chip: null });
  expect(items.find((i) => i.id === "past")).toMatchObject({ tone: "late", chip: "Needs close-out" });
  expect(items.find((i) => i.id === "a")).toMatchObject({ tone: "open", day: "2026-11-24" });
  expect(dotsByDay([...items, ...items]).get("2026-11-24")).toHaveLength(3);
});

test("a callback row says the customer's clock; an appointment row who set it (board C13)", () => {
  const [callback, appointment] = calendarItems([cb({})], [appt({})], NY, NOW);
  expect(itemMeta(callback, NY, "me")).toBe("Callback · their time 8:30 CT");
  expect(itemMeta(appointment, NY, "me")).toBe("Appointment · set by Lena");
  const [, bySetter] = calendarItems([cb({})], [appt({ bookedByRole: "setter" })], NY, NOW);
  expect(itemMeta(bySetter, NY, "me")).toBe("Appointment · set by Lena (setter)");
  expect(setterLine(appt({ bookedByRole: "setter" }), "me")).toBe("Final expense · set by Lena Park (setter)");
});

test("C8b: With offers the producers licensed in the lead's state", () => {
  const agents = [{ userId: "ava", name: "Ava Kim" }, { userId: "tom", name: "Tom Baker" }];
  expect(bookableAgents(agents, { ava: ["GA"], tom: ["FL"] }, "GA")).toEqual({ agents: [{ userId: "ava", name: "Ava Kim" }], licensedIn: "GA" });
  // No licences recorded at all, or no state on the lead: everyone the server lists.
  expect(bookableAgents(agents, {}, "GA")).toEqual({ agents, licensedIn: null });
  expect(bookableAgents(agents, { ava: ["GA"] }, null)).toEqual({ agents, licensedIn: null });
  expect(bookableAgents(agents, null, "GA")).toEqual({ agents, licensedIn: null });
});

test("the appointment's time line and who set it", () => {
  expect(appointmentWhen(appt({}), NY)).toBe("Tue 24 Nov · 2:00 – 3:00 pm");
  expect(appointmentWhen(appt({ customerTimezone: "America/Chicago" }), NY)).toBe("Tue 24 Nov · 1:00 – 2:00 pm CT · 2:00 – 3:00 pm yours");
  expect(setterLine(appt({}), "me")).toBe("Final expense · set by Lena Park");
  expect(setterLine(appt({}), "boss")).toBe("Final expense · with Ava Kim · set by Lena Park");
  expect(setterLine(appt({ bookedByUserId: "me" }), "me")).toBe("Final expense · set by you");
});

const ctx = (over: Partial<BookableContext> = {}): BookableContext => ({
  agents: [{ userId: "ava", name: "Ava Kim", timezone: NY }],
  availability: [3, 4].map((weekday) => ({ userId: "ava", weekday, startTime: "10:00", endTime: "12:00", timezone: NY })),
  blocks: [], policy: [{ userId: "ava", appointmentMinutes: 60, bufferMinutes: 0, maxPerDay: null }], upcoming: [], busy: [],
  ...over,
});

test("free times come from working hours, minus bookings and blocks (the web's openSlots)", () => {
  expect(openSlots(ctx(), "ava", NOW, { days: 14, limit: 6 })).toEqual([
    "2026-11-25T15:00:00.000Z", "2026-11-25T16:00:00.000Z", "2026-11-26T15:00:00.000Z", "2026-11-26T16:00:00.000Z",
    "2026-12-02T15:00:00.000Z", "2026-12-02T16:00:00.000Z",
  ]);
  const taken = openSlots(ctx({ upcoming: [{ agentUserId: "ava", startsAtUtc: "2026-11-25T15:00:00.000Z", durationMinutes: 60, status: "booked" }], blocks: [{ userId: "ava", startsAt: "2026-11-26T15:00:00Z", endsAt: "2026-11-26T17:00:00Z", repeats: "none" }] }), "ava", NOW, { days: 14, limit: 2 });
  expect(taken).toEqual(["2026-11-25T16:00:00.000Z", "2026-12-02T15:00:00.000Z"]);
  expect(openSlots(ctx({ availability: [] }), "ava", NOW)).toEqual([]);
});

test("the slot line says whose time the slots are in and how ours relates", () => {
  const at = new Date(NOW);
  expect(hoursAhead("America/Chicago", NY, at)).toBe(1);
  expect(zoneLine("Ava", "Linda", NY, NY, NY, at)).toBe("Ava’s free times · Ava’s time = Linda’s (Eastern) = yours");
  expect(zoneLine("Ava", "Linda", "America/Chicago", NY, NY, at)).toBe("Ava’s free times · in Linda’s time (Central) · yours is 1 h ahead");
});

test("slot labels never repeat a weekday from the next week", () => {
  expect(slotLabel("2026-11-25T15:00:00.000Z", NY, NOW)).toBe("Wed 10:00");
  expect(slotLabel("2026-12-02T15:00:00.000Z", NY, NOW)).toBe("2 Dec 10:00");
});

describe("board C13b · the customer's address and Directions", () => {
  test("two lines from the lead's own address, or nothing", () => {
    expect(addressLines({ street: "22 Abercorn St", city: "Savannah", state: "GA", zip: "31401" })).toEqual({ first: "22 Abercorn St", second: "Savannah, GA 31401", query: "22 Abercorn St, Savannah, GA 31401" });
    expect(addressLines({ street: null, city: "Savannah", state: "GA", zip: null })).toEqual({ first: "Savannah, GA", second: null, query: "Savannah, GA" });
    expect(addressLines(null)).toBeNull();
    expect(addressLines({ street: null, city: null, state: "GA", zip: null })).toBeNull();
  });
  test("Directions opens the phone's own maps app", () => {
    expect(directionsUrl("22 Abercorn St, Savannah", "android")).toBe("geo:0,0?q=22%20Abercorn%20St%2C%20Savannah");
    expect(directionsUrl("22 Abercorn St", "ios")).toBe("http://maps.apple.com/?daddr=22%20Abercorn%20St");
  });
  test("C11's appointment row says the customer's clock and who set it", () => {
    expect(appointmentMeta(appt({}), "me")).toBe("Appointment · 2:00 pm ET · set by Lena Park");
  });
});
