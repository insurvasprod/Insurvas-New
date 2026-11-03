import assert from "node:assert/strict";
import test from "node:test";

import { normalizeZip, stateForZip } from "./zipState.ts";

test("well-known ZIPs resolve to their state", () => {
  const known = {
    "10001": "NY", "90210": "CA", "60601": "IL", "33101": "FL", "02108": "MA", "02903": "RI",
    "20500": "DC", "20101": "VA", "73301": "TX", "73102": "OK", "88510": "TX", "87501": "NM",
    "99501": "AK", "96813": "HI", "05601": "VT", "05501": "MA", "39201": "MS", "39901": "GA",
    "84101": "UT", "89501": "NV", "97201": "OR", "98101": "WA", "83702": "ID", "82001": "WY",
  };
  for (const [zip, state] of Object.entries(known)) assert.equal(stateForZip(zip), state, zip);
});

test("territories, military and unassigned prefixes return null, so the form asks for the state", () => {
  for (const zip of ["00901", "09001", "34001", "96201", "96910", "71501", "88801"]) assert.equal(stateForZip(zip), null, zip);
});

test("ZIP+4 is accepted and anything else is not a ZIP", () => {
  assert.equal(normalizeZip("75201-1234"), "75201");
  assert.equal(normalizeZip(" 752011234 "), "75201");
  assert.equal(stateForZip("75201-1234"), "TX");
  for (const bad of ["", "7520", "752011", "ABCDE", "75 201"]) assert.equal(normalizeZip(bad), null, bad);
});
