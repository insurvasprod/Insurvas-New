"use client";

import { notify } from "@/lib/notify";
import { REASON_WORDS } from "@/lib/leadPost/board";
import { GUIDE_REPLIES } from "@/lib/leadPost/guide";
import { copyText, send } from "./shared";

/**
 * The vendor's instructions, leaving the page three ways (board A5): copied (as text, or as a link to
 * the public page once 20261112100100 is applied), downloaded as a PDF, or emailed from the owner's
 * own mail app. Email is a mailto: — the owner sends it, from their address, and sees it in their
 * Sent folder; nothing is sent on their behalf.
 */

const guideUrl = (keyId: string | null, format?: "pdf") => {
  const params = new URLSearchParams();
  if (keyId) params.set("key", keyId);
  if (format) params.set("format", format);
  const query = params.toString();
  return `/api/app/lead-post-keys/guide${query ? `?${query}` : ""}`;
};

export async function guideTextFor(keyId: string | null): Promise<string> {
  const body = await send<{ text: string }>(guideUrl(keyId), "GET");
  return body.text;
}

export async function copyInstructions(keyId: string | null) {
  try {
    await copyText(await guideTextFor(keyId), "Instructions copied.");
  } catch (cause) {
    notify.fail(cause instanceof Error ? cause.message : "The instructions could not be copied.");
  }
}

export function downloadInstructions(keyId: string | null) {
  const link = document.createElement("a");
  link.href = guideUrl(keyId, "pdf");
  link.rel = "noopener";
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** A fresh public link (the old one stops working), copied. Needs 20261112100100. */
export async function copyInstructionsLink(keyId: string): Promise<boolean> {
  try {
    const body = await send<{ url: string }>(`/api/app/lead-post-keys/${keyId}`, "PATCH", { action: "instructions_link" });
    await copyText(body.url, "Link copied. Anyone with it can read the instructions; it never shows the key.");
    return true;
  } catch (cause) {
    notify.fail(cause instanceof Error ? cause.message : "The link could not be made.");
    return false;
  }
}

/** Opens the owner's mail app with the instructions, and records who they went to when it can. */
export async function emailInstructions(input: { keyId: string; vendorName: string; to: string; cc?: string; agencyName: string; recordSent: boolean }) {
  try {
    const text = await guideTextFor(input.keyId);
    const subject = `Posting leads to ${input.agencyName}`;
    const body = `Hello ${input.vendorName} team,\n\nHere is how to post leads to us. Your posting key is sent separately.\n\n${text}`;
    const params = new URLSearchParams();
    if (input.cc?.trim()) params.set("cc", input.cc.trim());
    params.set("subject", subject);
    params.set("body", body);
    window.location.href = `mailto:${encodeURIComponent(input.to.trim())}?${params.toString().replace(/\+/g, "%20")}`;
    if (input.recordSent) await send(`/api/app/lead-post-keys/${input.keyId}`, "PATCH", { action: "instructions_sent", email: input.to.trim() || null }).catch(() => null);
  } catch (cause) {
    notify.fail(cause instanceof Error ? cause.message : "The email could not be opened.");
  }
}

/**
 * "Tell vendor" (board A9): an email, from the owner's own mail app, naming the refused posts and the
 * rule they broke, so the vendor fixes their side and stops billing them.
 */
export function tellVendor(input: { to: string; vendorName: string; agencyName: string; reasonCode: string; count: number; days: number }) {
  const words = REASON_WORDS[input.reasonCode] ?? input.reasonCode;
  const rule = GUIDE_REPLIES.find((reply) => reply.code === input.reasonCode)?.meaning ?? "";
  const period = input.days === 1 ? "today" : `in the last ${input.days} days`;
  const params = new URLSearchParams();
  params.set("subject", `${input.count} refused ${input.count === 1 ? "post" : "posts"}: ${words.toLowerCase()}`);
  params.set("body", `Hello ${input.vendorName} team,

${input.count} of your posts to ${input.agencyName} ${period} were refused with reason_code ${input.reasonCode} (${words.toLowerCase()}). ${rule}

Refused posts are not billable. Please fix this on your side so the next posts are accepted.

Thank you.`);
  window.location.href = `mailto:${encodeURIComponent(input.to.trim())}?${params.toString().replace(/\+/g, "%20")}`;
}
