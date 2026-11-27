import { licenceBody } from "../add-licence";

describe("Add a licence (board I7)", () => {
  test("needs a state", () => {
    expect(licenceBody({ state: null, type: "resident", number: "", expires: "" })).toEqual({ error: "Choose the state." });
  });
  test("sends the web's licence fields, the expiry as an ISO day", () => {
    expect(licenceBody({ state: "TX", type: "non_resident", number: " 1234567 ", expires: "12/09/2026" })).toEqual({
      body: { state: "TX", license_number: "1234567", expires_at: "2026-12-09", licence_type: "non_resident" },
    });
  });
  test("blank number and expiry go as blanks (the server stores its placeholders)", () => {
    expect(licenceBody({ state: "FL", type: null, number: "", expires: "" })).toEqual({ body: { state: "FL", license_number: "", expires_at: "", licence_type: null } });
  });
  test("refuses a date that isn't real", () => {
    expect(licenceBody({ state: "FL", type: "resident", number: "", expires: "02/30/2027" })).toEqual({ error: "Enter the expiry as MM/DD/YYYY." });
  });
});
