import { windowLine } from "@/components/home/when";
import { needsUpdate } from "@/lib/answer-state";
import { helpGroups, screenFor } from "@/lib/help-topics";
import { lastScreen, noteScreen } from "@/lib/last-screen";
import { linkMail } from "@/lib/links";
import { setterLines, setterWeek, weekNumber, type ScoreRow } from "@/lib/setter-week";
import { hourWords, hoursToday } from "@/lib/work-hours";

describe("B1 calling-window line", () => {
  it("says how many states are open and when the last closes", () => {
    expect(windowLine({ openStates: 31, closesAt: "9:00 pm ET", opensAt: null })).toEqual({ open: true, text: "Calling window open in 31 states · closes 9:00 pm ET" });
    expect(windowLine({ openStates: 1, closesAt: null, opensAt: null })?.text).toBe("Calling window open in 1 state");
  });
  it("says when it opens when every state is closed, and nothing without an answer", () => {
    expect(windowLine({ openStates: 0, closesAt: null, opensAt: "8:00 am ET" })).toEqual({ open: false, text: "Calling window closed · opens 8:00 am ET" });
    expect(windowLine({ openStates: 0, closesAt: null, opensAt: null })?.text).toBe("Calling window closed for today");
    expect(windowLine(undefined)).toBeNull();
  });
});

describe("B3 setter week", () => {
  // Wednesday 25 Nov 2026; the week began Monday 23 Nov.
  const now = new Date(2026, 10, 25, 14, 0);
  const row = (day: string, booked: number, extra: Partial<ScoreRow> = {}): ScoreRow => ({ userId: "u", day, dials: 0, contacts: 0, booked, showed: 0, noShow: 0, ...extra });
  const rows = [
    row("2026-11-25", 2, { dials: 40, contacts: 9 }),
    row("2026-11-24", 4),
    row("2026-11-23", 12),
    row("2026-11-18", 5, { showed: 2, noShow: 1 }),
    row("2026-11-10", 3, { showed: 3, noShow: 0 }),
  ];

  it("counts the week from Monday against the target", () => {
    const w = setterWeek(rows, { goal: { state: "set", target: 25 } }, now);
    expect(w).toMatchObject({ week: 48, target: 25, booked: 18, toGo: 7, yesterdayBooked: 4, lastWeekShowed: 2, today: { dials: 40, contacts: 9, booked: 2 }, showRatePct: 83 });
    expect(setterLines(w)).toEqual({ title: "7 to go this week", body: "You set 4 yesterday. 2 of last week’s showed up." });
  });

  it("without a target says what was set, and the show rate is empty with nothing closed out", () => {
    const w = setterWeek([row("2026-11-25", 3)], { goal: { state: "none" } }, now);
    expect(w.target).toBeNull();
    expect(w.showRatePct).toBeNull();
    expect(setterLines(w).title).toBe("3 set this week");
  });

  it("numbers weeks the ISO way", () => {
    expect(weekNumber(new Date(2026, 0, 1))).toBe(1);
    expect(weekNumber(new Date(2026, 10, 24))).toBe(48);
  });
});

describe("J4 help topics", () => {
  it("names the screen and its guides, and keeps them out of Popular", () => {
    const g = helpGroups("/calls", "dialer");
    expect(g.screen?.name).toBe("Dialer");
    expect(g.screen?.guides.map((x) => x.slug)).toEqual(["call-next-lead", "book-callback", "find-consent"]);
    expect(g.popular.map((x) => x.slug)).toEqual(["claim-transfer", "submit-application"]);
  });
  it("knows the main screens and nothing else", () => {
    expect(screenFor("/calls")?.name).toBe("Incoming calls");
    expect(screenFor("/lead/abc")?.name).toBe("Leads");
    expect(screenFor("/")?.name).toBe("Home");
    expect(screenFor("/profile")).toBeNull();
    expect(helpGroups("/profile").popular).toHaveLength(3);
  });
  it("remembers the last screen worked on, never the menu's pages", () => {
    noteScreen("/calls", "callbacks");
    noteScreen("/menu");
    noteScreen("/menu/help");
    noteScreen("/settings");
    expect(lastScreen()).toEqual({ pathname: "/calls", part: "callbacks" });
  });
});

describe("J3 working hours", () => {
  it("writes today's hours as the board does", () => {
    expect(hourWords("08:30")).toBe("8:30 am");
    expect(hourWords("18:00")).toBe("6 pm");
    expect(hourWords("00:00")).toBe("12 am");
    const hours = [{ weekday: 2, startTime: "08:30", endTime: "18:00" }];
    expect(hoursToday(hours, "America/New_York", 2)).toBe("8:30 am – 6 pm ET");
    expect(hoursToday(hours, "Europe/Paris", 2)).toBe("8:30 am – 6 pm");
    expect(hoursToday(hours, null, 3)).toBe("Off today");
    expect(hoursToday([], null, 3)).toBeNull();
  });
});

describe("J2 email me the link · M8 update needed", () => {
  it("mails the person's own address with the link", () => {
    expect(linkMail("ava@x.com", "List import", "https://app.insurvas.com/app/import")).toBe(
      "mailto:ava%40x.com?subject=List%20import%20in%20Insurvas&body=Open%20this%20on%20your%20computer%3A%0Ahttps%3A%2F%2Fapp.insurvas.com%2Fapp%2Fimport",
    );
    expect(linkMail(null, "X", "u").startsWith("mailto:?subject=")).toBe(true);
  });
  it("asks for an update only on 426 or app_update_required", () => {
    expect(needsUpdate({ status: 426, code: null })).toBe(true);
    expect(needsUpdate({ status: 400, code: "app_update_required" })).toBe(true);
    expect(needsUpdate({ status: 500, code: null })).toBe(false);
    expect(needsUpdate(null)).toBe(false);
  });
});
