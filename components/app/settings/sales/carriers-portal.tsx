"use client";

/**
 * LA-3.22 · opening a carrier's portal with the agency's username on the clipboard. The portal
 * account itself (username, MFA, last checked) is edited on Settings › Carriers (carrier-card.tsx);
 * there is never a password: no field, no key, no column holds one.
 */

import { notify } from "@/lib/notify";

/** Open the portal in a new tab and put the username on the clipboard, saying exactly what was copied. */
export async function openPortal(url: string, username: string | null) {
  if (username) {
    try {
      await navigator.clipboard.writeText(username);
      notify.done(`Copied the username “${username}”`, { detail: "Paste it into the portal's sign-in. The password comes from your password manager." });
    } catch {
      notify.warn("The username could not be copied", { detail: `Type it in: ${username}` });
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyUsername(username: string) {
  try {
    await navigator.clipboard.writeText(username);
    notify.done(`Copied the username “${username}”`);
  } catch {
    notify.warn("The username could not be copied", { detail: `Type it in: ${username}` });
  }
}
