/**
 * The partner chat composer's limit, shared by the textarea (maxLength and the "0 / 2,000" counter)
 * and the API's schema. lib/partnerChat/service.ts enforces the same 2,000 again at write time.
 * Plain module: safe to import from a "use client" component.
 */
export const PARTNER_CHAT_MESSAGE_MAX = 2000;

const count = new Intl.NumberFormat("en-US");

/** "0 / 2,000", as the board writes it. */
export function composerCountLabel(length: number, max: number = PARTNER_CHAT_MESSAGE_MAX) {
  return `${count.format(Math.max(0, Math.trunc(length)))} / ${count.format(max)}`;
}
