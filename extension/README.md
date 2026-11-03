# Insurvas carrier fill (browser extension)

Manifest V3, plain JavaScript, no build step. LA-3.12 (grants), LA-3.13 (field maps) and LA-3.14
(copy-assist). It fills a carrier's application form from one Insurvas application; it never submits.

## Load it unpacked

1. Open `chrome://extensions` and switch on **Developer mode**.
2. **Load unpacked** → choose this `extension/` folder.
3. Open Insurvas (`http://localhost:3000` in development). The Submit step of an application now
   shows the **Fill on carrier site** button as available.

## How a fill works

1. On a `ready` application, **Fill on carrier site** asks Insurvas for a grant (60 minutes, one
   application, one carrier origin) and posts it to its own window. `content/bridge.js` checks the
   message's origin and forwards it to the service worker. The token is never in a URL, in
   `localStorage`, in `chrome.storage` or in the page's DOM.
2. The service worker keeps the grant **in memory only** and forgets it at expiry. If Chrome stops the
   worker (the side panel keeps it alive while open), press **Fill on carrier site** again.
3. Open the side panel (the toolbar icon). The first time, it asks to be allowed on the carrier's
   site — a per-origin permission, requested at runtime. There is no `<all_urls>`.
4. On the carrier's page the side panel reads the application (through `content/carrier.js`, so the
   request's `Origin` is the carrier's — Insurvas refuses any other origin for that grant) and shows
   copy-assist. The SSN and bank / card numbers are not in that read; each is fetched on its own when
   copied or filled, and Insurvas logs every such read.
5. **Fill this page** runs the published field map: selector → value (already transformed by
   Insurvas) → `input` / `change` events. A selector that finds nothing fills nothing, is reported as
   a map miss (the map goes to *needs review*), and is marked in the copy list. **Highlight** outlines
   the fields the map finds.
6. You check the page and press the carrier's own Next / Submit.

A page whose map step has no URL pattern (`*`) is filled opportunistically and its misses are not
reported — the extension cannot tell "not on this page" from "not found" without one. Fields inside
iframes are not filled.

## Setting the API origin

The Insurvas origins the extension trusts are listed in **four** places; keep them identical:

| File | Key |
|---|---|
| `config.js` | `APP_ORIGINS` |
| `manifest.json` | `host_permissions` |
| `manifest.json` | `content_scripts[0].matches` |
| `manifest.json` | the `connect-src` of `content_security_policy.extension_pages` |

`https://app.insurvas.com` is a placeholder for the production origin. The service worker accepts a
grant only from a page on one of `APP_ORIGINS`, and the requests go to that same origin.

## Server side

`EXTENSION_GRANT_SIGNING_KEY` (32+ characters) must be set on the Insurvas server, and the agency
needs the `carrier_extension` feature. Endpoints: `POST /api/app/extension/grant`,
`GET /api/app/extension/fields`, `GET /api/app/extension/fields/[key]`,
`POST /api/app/extension/map-miss`, `GET|PUT /api/app/extension/ticks`.
