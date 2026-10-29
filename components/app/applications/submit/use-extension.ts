"use client";

import { useState, useSyncExternalStore } from "react";
import { notify } from "@/lib/notify";

import { EXTENSION_MARKER, GRANT_ACK_MESSAGE, GRANT_MESSAGE } from "@/lib/extension/constants";

/**
 * Whether the Insurvas browser extension (LA-3.12) is installed in this browser. The extension's
 * bridge content script marks the page's root element with its version when it loads.
 */
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [EXTENSION_MARKER] });
  return () => observer.disconnect();
};

export function useExtensionDetected() {
  return useSyncExternalStore(subscribe, () => document.documentElement.hasAttribute(EXTENSION_MARKER), () => false);
}

/** The installed extension's version, or null. */
export function useExtensionVersion() {
  return useSyncExternalStore(subscribe, () => document.documentElement.getAttribute(EXTENSION_MARKER) || null, () => null);
}

type Grant = { token: string; grantId: string; expiresAt: string; origin: string; applicationId: string };

/**
 * Hands a grant to the extension: window.postMessage to THIS window's own origin, where the bridge
 * content script listens (it checks event.origin and event.source). Never a URL, never
 * localStorage, never the DOM. Resolves when the extension acknowledges, or after 3 seconds.
 */
function postToExtension(grant: Grant): Promise<{ ok: boolean; error: string | null }> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { window.removeEventListener("message", onAck); resolve({ ok: false, error: "The Insurvas extension didn't answer. Reload the page and try again." }); }, 3000);
    function onAck(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; requestId?: string; ok?: boolean; error?: string | null } | null;
      if (!data || data.type !== GRANT_ACK_MESSAGE || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onAck);
      resolve({ ok: Boolean(data.ok), error: data.error ?? null });
    }
    window.addEventListener("message", onAck);
    window.postMessage({ type: GRANT_MESSAGE, requestId, token: grant.token, grantId: grant.grantId, expiresAt: grant.expiresAt, origin: grant.origin, applicationId: grant.applicationId }, window.location.origin);
  });
}

/** "Fill on carrier site": mint a 60-minute grant for this attempt and give it to the extension. */
export function useFillOnCarrierSite(input: { applicationId: string; carrierId: string | null; carrierName: string | null; sample: boolean }) {
  const [busy, setBusy] = useState(false);
  async function start() {
    if (input.sample) {
      notify.warn("Sample data — the extension fills the carrier's form on a real application.");
      return;
    }
    if (!input.carrierId) {
      notify.block("Choose the carrier on the Quote step first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/app/extension/grant", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: input.applicationId, carrier_id: input.carrierId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        notify.block(data?.error ?? "Couldn't open a grant for the extension.");
        return;
      }
      const sent = await postToExtension(data as Grant);
      if (!sent.ok) {
        notify.block(sent.error ?? "The extension didn't take the grant.");
        return;
      }
      const host = String((data as Grant).origin).replace(/^https:\/\//, "");
      notify.done(`Ready to fill on ${input.carrierName ?? host}`, { detail: `Open ${host}, then press Fill in the Insurvas side panel. The grant lasts 60 minutes.` });
    } catch {
      notify.fail("Couldn't reach Insurvas. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return { start, busy };
}
