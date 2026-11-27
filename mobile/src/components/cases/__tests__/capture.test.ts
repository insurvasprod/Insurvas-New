import { ApiError } from "@/lib/api";

import { documentsPath, sendPages, type Page } from "../capture";

jest.mock("expo-image-picker", () => ({}));

/** Board E6b: pages go one a request to the requirement's documents route, and a retry never sends a page twice. */
type Part = { fieldName: string; string?: string; uri?: string };
const calls: { url: string; parts: Part[]; auth: string }[] = [];
const pages: Page[] = [1, 2, 3].map((n) => ({ uri: `file:///p${n}.jpg`, name: `page-${n}.jpg`, type: "image/jpeg" }));

/** FormData as React Native builds it: a file is {uri, name, type}. */
class FakeForm {
  parts: Part[] = [];
  append(fieldName: string, v: unknown) { this.parts.push(typeof v === "string" ? { fieldName, string: v } : { fieldName, uri: (v as { uri: string }).uri }); }
  getParts() { return this.parts; }
}
globalThis.FormData = FakeForm as unknown as typeof FormData;

function serve(failAt: number | null = null) {
  calls.length = 0;
  globalThis.fetch = jest.fn(async (url: string, init: { body: { getParts: () => Part[] }; headers: Record<string, string> }) => {
    calls.push({ url, parts: init.body.getParts(), auth: init.headers.authorization });
    if (failAt !== null && calls.length === failAt) throw new TypeError("Network request failed");
    return { ok: true, status: 201, json: async () => ({ stored: 1 }) };
  }) as unknown as typeof fetch;
}

test("each page is its own request with its place; the note rides with the last", async () => {
  serve();
  const sent: number[] = [];
  await sendPages({ token: "t", attemptId: "a1", requirementId: "r1", pages, note: "Records 2023–2026", onSent: (n) => sent.push(n) });
  expect(calls.map((c) => c.url)).toEqual(Array(3).fill(expect.stringMatching(new RegExp(`${documentsPath("a1", "r1")}$`))));
  expect(calls[0].auth).toBe("Bearer t");
  const fields = (i: number) => Object.fromEntries(calls[i].parts.map((p) => [p.fieldName, p.string ?? p.uri]));
  expect(fields(0)).toEqual({ file: "file:///p1.jpg", page: "1", pages: "3" });
  expect(fields(2)).toEqual({ file: "file:///p3.jpg", page: "3", pages: "3", note: "Records 2023–2026" });
  expect(sent).toEqual([1, 2, 3]);
});

test("a dropped signal stops at the page that failed; the retry starts there", async () => {
  serve(2);
  const sent: number[] = [];
  await expect(sendPages({ token: "t", attemptId: "a1", requirementId: "r1", pages, note: "", onSent: (n) => sent.push(n) })).rejects.toBeInstanceOf(ApiError);
  expect(sent).toEqual([1]);
  serve();
  await sendPages({ token: "t", attemptId: "a1", requirementId: "r1", pages, note: "", from: 1 });
  expect(calls.map((c) => c.parts.find((p) => p.fieldName === "page")?.string)).toEqual(["2", "3"]);
});
