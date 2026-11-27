import { resolveIntentPath, spokenFeature } from "@/components/native/intents";

import { collectGoalPct, compactDollars, shortMonth, theirTimeLine, updatedLabel } from "../data";

describe("Google Assistant phrases (board L5)", () => {
  test("map what was heard to a shortcut", () => {
    expect(spokenFeature("next callback")).toBe("next-callback");
    expect(spokenFeature("What's my next callback?")).toBe("next-callback");
    expect(spokenFeature("add a lead")).toBe("add-lead");
    expect(spokenFeature("check a number")).toBe("check-number");
    expect(spokenFeature("search")).toBe("search");
    expect(spokenFeature("start calling")).toBe("serve-next");
    expect(spokenFeature("the weather")).toBeNull();
    expect(spokenFeature("")).toBeNull();
  });
  test("insurvas://open?feature= opens the screen the words mean, and nothing for words it doesn't know", () => {
    // Asked aloud, the answer comes back on the spoken-answer card (board L5), not the list.
    expect(resolveIntentPath("insurvas://open?feature=next%20callback", 3)).toBe("/ask?q=next-callback&n=3");
    expect(resolveIntentPath("insurvas://open?feature=add%20a%20lead", 5)).toBe("/leads?add=5");
    expect(resolveIntentPath("insurvas://open?feature=pizza")).toBeNull();
  });
});

describe("widget figures (board L1)", () => {
  test("money is compact, as on the board", () => {
    expect(compactDollars(8_640_000)).toBe("$86.4k");
    expect(compactDollars(120_000_000)).toBe("$1.2M");
    expect(compactDollars(94_000)).toBe("$940");
    expect(compactDollars(10_000_000)).toBe("$100k");
  });
  test("months and the updated time", () => {
    expect(shortMonth("2026-11")).toBe("Nov");
    expect(shortMonth("2026-01", 1)).toBe("Dec");
    expect(updatedLabel(new Date(2026, 10, 25, 21, 40).toISOString())).toBe("9:40");
  });
});

describe("the customer's clock (board L1: \"10:30 his time (CT)\")", () => {
  test("always shows when the server sent the customer's zone", () => {
    expect(theirTimeLine({ theirs: "10:30", zone: "CT" })).toBe("10:30 their time (CT)");
    expect(theirTimeLine({ theirs: null, zone: null })).toBeNull();
  });
});

describe("the widget's goal (board L1: \"Goal 64%\")", () => {
  const answers = (map: Record<string, unknown>) => jest.fn(async (path: string) => {
    if (!(path in map)) throw new Error(`unexpected ${path}`);
    const v = map[path];
    if (v instanceof Error) throw v;
    return v;
  }) as unknown as <T>(path: string) => Promise<T>;
  const today = "2026-11-25";
  const book = { today, money: true, available: true, issued: { since: "2026-10-01", days: [{ day: "2026-11-10", count: 2, cents: 1_600_000 }] }, paymentMissed: { count: 0, saveBy: null } };

  test("a producer: the month's issued premium against the goal they set, as the Home ring measures it", async () => {
    const api = answers({ "/api/app/home/producer": book, "/api/app/goals?kind=premium&for=me": { goal: { state: "set", target: 2_500_000 } } });
    await expect(collectGoalPct(api, "producer")).resolves.toBe(64);
  });
  test("no goal set: nothing, never the last-month fallback", async () => {
    const api = answers({ "/api/app/home/producer": book, "/api/app/goals?kind=premium&for=me": { goal: { state: "none" } } });
    await expect(collectGoalPct(api, "producer")).resolves.toBeNull();
  });
  test("a setter: this week's booked against the weekly target", async () => {
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const day = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
    const api = answers({
      "/api/app/scorecard?days=30": { rows: [{ userId: "s", day, dials: 40, contacts: 10, booked: 4, showed: 0, noShow: 0 }] },
      "/api/app/goals?kind=booked&for=me": { goal: { state: "set", target: 10 } },
    });
    await expect(collectGoalPct(api, "setter")).resolves.toBe(40);
  });
  test("a refused read, or a role whose widget has no goal, draws none", async () => {
    await expect(collectGoalPct(answers({ "/api/app/home/producer": new Error("Not on your plan"), "/api/app/goals?kind=premium&for=me": { goal: { state: "set", target: 1 } } }), "producer")).resolves.toBeNull();
    await expect(collectGoalPct(answers({}), "producer", "manager")).resolves.toBeNull();
    await expect(collectGoalPct(answers({}), "assistant")).resolves.toBeNull();
  });
});
