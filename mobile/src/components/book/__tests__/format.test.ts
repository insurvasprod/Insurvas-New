import { dayMonth, dayMonthYear, draftDayText, faceMoney, firstWord, lineTitle, money, moneyParts, premiumText, slashDate, toneOf } from "../format";

/** The Book writes money and days as the web does (lib/ingestion/policyMoney.ts `cents`, the policy page's strip). */
test("money keeps its cents, with a minus sign for money going out", () => {
  expect(money(4120)).toBe("$41.20");
  expect(money(37080)).toBe("$370.80");
  expect(money(-9270)).toBe("−$92.70");
  expect(money(123456789)).toBe("$1,234,567.89");
  expect(money(null)).toBe("—");
});

test("a face amount drops .00, as the web's strip writes it", () => {
  expect(faceMoney(1000000)).toBe("$10,000");
  expect(faceMoney(1000050)).toBe("$10,000.50");
});

test("the money figure's parts: small $ and cents beside the whole", () => {
  expect(moneyParts(4120)).toEqual({ sign: "", whole: "41", cents: "20" });
  expect(moneyParts(1000000, true)).toEqual({ sign: "", whole: "10,000", cents: null });
  expect(moneyParts(-9270)).toEqual({ sign: "−", whole: "92", cents: "70" });
});

test("premium with its mode", () => {
  expect(premiumText(4120, "monthly")).toBe("$41.20/mo");
  expect(premiumText(52800, "annual")).toBe("$528.00/yr");
  expect(premiumText(null, "monthly")).toBeNull();
});

test("days as the board writes them", () => {
  expect(dayMonthYear("2026-03-02")).toBe("2 Mar 2026");
  expect(dayMonth("2026-12-03T10:00:00Z")).toBe("3 Dec");
  expect(dayMonth(null)).toBe("—");
  expect(slashDate("1961-07-02")).toBe("07/02/1961");
  expect(draftDayText(3)).toBe("3rd of the month");
  expect(draftDayText(11)).toBe("11th of the month");
  expect(draftDayText(22)).toBe("22nd of the month");
  expect(draftDayText(null)).toBeNull();
});

test("web tones become the app's chip tones", () => {
  expect(toneOf("good")).toBe("ok");
  expect(toneOf("warning")).toBe("warn");
  expect(toneOf("danger")).toBe("bad");
  expect(toneOf("info")).toBe("info");
  expect(toneOf("neutral")).toBe("neutral");
});

test("an advance line says how many months it advanced", () => {
  expect(lineTitle({ label: "Advance", type: "advance", monthsAdvanced: 9 })).toBe("Advance · 9 months");
  expect(lineTitle({ label: "Earned", type: "earned", monthsAdvanced: 9 })).toBe("Earned");
  expect(firstWord("Maria Alvarez")).toBe("Maria");
});
