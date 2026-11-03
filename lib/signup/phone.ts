/**
 * Sign-up phone numbers (2026-10-26, owner: "a drop-down prefix and validation to check if the phone
 * number is correct … add all of the world countries … a placeholder for each country's number").
 * Plain module: the form picks a country and checks the number as it is typed; the sign-up route
 * checks it again and stores it in E.164 ("+12015550123").
 *
 * The rules are libphonenumber-js (Google's libphonenumber metadata): every country it knows, its
 * calling code, an example mobile number in the country's own national format (the placeholder), and
 * whether a typed number is a valid one for that country. Valid means the shape is right for that
 * country's numbering plan; it does not prove the number is in service.
 */
import { getCountries, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";

export type PhoneCountry = { code: string; name: string; dial: string; example: string };

export const DEFAULT_PHONE_COUNTRY = "US";

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();

/** Every country, the United States first, then by name. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountries()
  .map((code) => ({
    code,
    name: regionName(code),
    dial: getCountryCallingCode(code),
    example: getExampleNumber(code, examples)?.formatNational() ?? "",
  }))
  .sort((a, b) => (a.code === DEFAULT_PHONE_COUNTRY ? -1 : b.code === DEFAULT_PHONE_COUNTRY ? 1 : a.name.localeCompare(b.name, "en")));

const BY_CODE = new Map(PHONE_COUNTRIES.map((country) => [country.code, country]));

export function phoneCountry(code: string): PhoneCountry | undefined {
  return BY_CODE.get(code);
}

/** Checks a number typed for a country (its national form, or with its own +prefix). Returns E.164 when valid. */
export function checkPhone(countryCode: string, typed: string): { ok: true; e164: string } | { ok: false; error: string } {
  const country = phoneCountry(countryCode);
  if (!country) return { ok: false, error: "Choose a country code" };
  const text = typed.trim();
  if (!text) return { ok: false, error: "Enter your phone number" };
  if (/[a-z]/i.test(text)) return { ok: false, error: "Use digits only" };
  const parsed = parsePhoneNumberFromString(text, country.code as CountryCode);
  if (!parsed || !parsed.isValid()) {
    return { ok: false, error: country.example ? `That isn't a valid ${country.name} number — it looks like ${country.example}` : `That isn't a valid ${country.name} number` };
  }
  return { ok: true, e164: parsed.number };
}

/** The server's half: a number with its country code ("+1 201 555 0123"). Returns its E.164 form when valid. */
export function checkInternationalPhone(text: string): { ok: true; e164: string } | { ok: false; error: string } {
  const value = text.trim();
  if (!value.startsWith("+")) return { ok: false, error: "Enter your phone number with its country code" };
  const parsed = parsePhoneNumberFromString(value);
  if (!parsed || !parsed.isValid()) return { ok: false, error: "That isn't a valid phone number" };
  return { ok: true, e164: parsed.number };
}

/** A saved number back into the form's two halves: its country and the national digits. */
export function splitPhone(e164: string | null | undefined): { country: string; national: string } {
  const parsed = e164 ? parsePhoneNumberFromString(e164) : undefined;
  if (!parsed?.country || !BY_CODE.has(parsed.country)) return { country: DEFAULT_PHONE_COUNTRY, national: "" };
  return { country: parsed.country, national: parsed.formatNational() };
}
