import test from "node:test";
import assert from "node:assert/strict";

const { runOrderedFallback } = await import("./fallback.ts");

const vendors = [
  { id: "primary", endpoint: "https://primary.example", credentials: "secret-a" },
  { id: "secondary", endpoint: "https://secondary.example", credentials: "secret-b" },
];

test("primary failure routes the compliance call to the secondary and records one fallback", async () => {
  const attempted = [];
  const fallbackEvents = [];
  const result = await runOrderedFallback(
    vendors,
    async (vendor) => {
      attempted.push(vendor.id);
      if (vendor.id === "primary") throw new Error("primary unavailable");
      return "scrubbed";
    },
    async (from, to) => fallbackEvents.push({ from: from.id, to: to.id }),
  );

  assert.equal(result, "scrubbed");
  assert.deepEqual(attempted, ["primary", "secondary"]);
  assert.deepEqual(fallbackEvents, [{ from: "primary", to: "secondary" }]);
});

test("when every compliance vendor fails, the last error is returned after each fallback", async () => {
  const fallbackEvents = [];
  await assert.rejects(
    () => runOrderedFallback(vendors, async (vendor) => { throw new Error(`${vendor.id} down`); }, async (from, to) => fallbackEvents.push({ from: from.id, to: to.id })),
    /secondary down/,
  );
  assert.deepEqual(fallbackEvents, [{ from: "primary", to: "secondary" }]);
});
