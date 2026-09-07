import "server-only";

import { createHash } from "node:crypto";
import type { ContactInput } from "./types";

export function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

export function normalizePhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function addressSearch(input: ContactInput) {
  const addressParts = [input.address_line1, input.city, input.postal_code].filter(Boolean);
  return addressParts.length ? normalizeText([...addressParts, input.state].filter(Boolean).join(" ")) : "";
}

export function addressHash(input: ContactInput) {
  const search = addressSearch(input);
  return search ? createHash("sha256").update(search).digest("hex") : null;
}

export function nameSearch(input: ContactInput) {
  return normalizeText(`${input.first_name} ${input.last_name}`);
}

export function normalizeContactInput(input: ContactInput): ContactInput {
  const primary = normalizePhone(input.primary_phone);
  const phones = [...(input.phones ?? [])];
  if (primary && !phones.some((phone) => phone.phone === primary)) phones.unshift({ phone: primary, type: "other", is_primary: true });
  const emails = [...(input.emails ?? [])];
  if (input.email?.trim() && !emails.some((email) => email.email === input.email?.trim().toLocaleLowerCase())) emails.unshift({ email: input.email.trim().toLocaleLowerCase(), is_primary: true });
  return { ...input, first_name: input.first_name.trim(), last_name: input.last_name.trim(), dob: input.dob || null, primary_phone: primary || null, state: input.state?.trim().toUpperCase() || null, address_line1: input.address_line1?.trim() || null, city: input.city?.trim() || null, postal_code: input.postal_code?.trim() || null, custom_fields: input.custom_fields ?? {}, phones: phones.map((phone) => ({ ...phone, phone: normalizePhone(phone.phone) })).filter((phone) => phone.phone), emails: emails.map((email) => ({ ...email, email: email.email.trim().toLocaleLowerCase() })).filter((email) => email.email) };
}
