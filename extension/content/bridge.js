// Runs on the Insurvas web app only (manifest content_scripts.matches). Two jobs:
//   1. mark the page so the Submit step knows the extension is installed;
//   2. receive a grant the page posts to ITSELF with window.postMessage, and forward it to the
//      service worker. The token is never put in a URL, localStorage, chrome.storage or the DOM.
(() => {
  const GRANT = "insurvas:extension-grant";
  const ACK = "insurvas:extension-grant-ack";
  const MARKER = "data-insurvas-extension";

  document.documentElement.setAttribute(MARKER, chrome.runtime.getManifest().version);

  const isString = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

  window.addEventListener("message", (event) => {
    // Only this window, only this origin: a frame or another site cannot hand us a token.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.type !== GRANT) return;
    const { token, expiresAt, origin, applicationId, grantId, requestId } = data;
    if (!isString(token, 4000) || !isString(expiresAt, 40) || !isString(origin, 300) || !isString(applicationId, 64) || !isString(grantId, 64)) return;

    const reply = (ok, error) => window.postMessage({ type: ACK, requestId: typeof requestId === "string" ? requestId : null, ok, error: error ?? null }, window.location.origin);
    chrome.runtime
      .sendMessage({ type: "grant", token, expiresAt, origin, applicationId, grantId, apiOrigin: window.location.origin })
      .then((res) => reply(Boolean(res && res.ok), res && res.error))
      .catch(() => reply(false, "The Insurvas extension didn't answer. Reload the page and try again."));
  });
})();
