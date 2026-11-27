# Mobile Release 3 · phone-only extras (L1, L3, L5, L6)

## Android development build: built and walked (26 November 2026)

| Board item | Status on Android | Code |
|---|---|---|
| **L1 · widgets** | Built and seen on the emulator. **Today** (4×2): next callback with both clocks, or "N to call back"; Start calling; the callbacks button. **Agency month** (2×2, owners and admins): submitted premium vs last month. Both draw from a snapshot the app keeps in secure storage, re-read when the app opens (at most every 5 minutes) and every 30 minutes by Android. Signing out wipes them to "Sign in to Insurvas". A widget never points at a hidden tab: an owner on Team · Money gets no Start calling, and the callbacks button opens the Calendar. Settings › This phone › **Add to home screen** / **Add the agency month** use the launcher's own pin card. | `mobile/src/widgets/*`, `mobile/index.ts` |
| **L3 · app-icon shortcuts** | Built and seen. The long-press menu is set per person after sign-in: a producer gets Serve next lead, Add a lead, Check a number and Search; an owner on Team · Money gets Check a number and Search. Each has its own icon from the board's icon set, and the menu is emptied on sign-out. A tap routes to the screen (verified: Check a number). | `mobile/src/components/native/quick-actions.ts`, `intents.ts` |
| **L5 · Google Assistant** | Built, not testable on the emulator. App Actions (`actions.intent.OPEN_APP_FEATURE`) need the app uploaded to Play Console. The capability sends `insurvas://open?feature=<words>`, and the app maps the words to a shortcut (unit-tested). | `mobile/plugins/with-android-app-actions.js`, `intents.ts` `spokenFeature` |
| **Build on Windows** | Gradle's C++ step hits the 260-character path limit under the OneDrive folder. Build from a short copy (`C:\m`), with the app's CMake folder at `C:/d` (Windows-only config plugin). Metro still serves the code from the original folder. | `mobile/plugins/with-windows-short-cmake-dir.js` |

Run the dev build:
1. Start Metro with the `mobile-devclient` launch entry.
2. Open `exp+insurvas://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081`.
3. Sign in by turning the minted dev link into `insurvas://dev-sign-in?…`.

## What runs in Expo Go now

| Board item | Status | Code |
|---|---|---|
| **L6 · Tablet** | Built. On a window 720 dp or wider: the list on the left (38% of the width, 320–420 dp), the real lead page on the right. | `mobile/src/components/native/split.tsx`, `record-split.tsx` |
| **L3 / L5 · links** | Built. These links open the right screen: `insurvas://serve-next`, `add-lead`, `check-number`, `search` and `next-callback`. | `mobile/src/app/+native-intent.tsx`, `mobile/src/components/native/intents.ts` |
| **L1 · widget data** | Built. The data the widget shows is built by the app; the widget itself never calls the server. | `mobile/src/components/native/widget-snapshot.ts` |

## What needs a development build, then a store build

These are not installed yet. Doing so is the owner's call.

- **Install:** run `npx expo install expo-quick-actions @bacons/apple-targets react-native-android-widget`.
- **app.json:**
  - Add `appleTeamId`.
  - Add the App Group entitlement `group.com.insurvas.app`.
  - Add the plugins `expo-quick-actions`, `@bacons/apple-targets`, `react-native-android-widget` (two widgets: Today and Agency month), `./plugins/with-android-shortcuts` and `./plugins/with-ios-app-intents`.
  - Set `enableBackgroundRemoteNotifications: true`, so widgets refresh on a silent push.
- **Android shortcuts:** static shortcuts serve both the long-press menu and Google App Actions (`actions.intent.OPEN_APP_FEATURE`). They're written by a config plugin to `res/xml/shortcuts.xml`.
- **iOS App Intents:** `InsurvasIntents.swift` (iOS 18 and later) covers Serve next lead, Add a lead, Check a number, "What's my next callback?" and Search.
  - "What's my next callback?" requires authentication.
  - Each intent opens an `insurvas://` link.
- **Root layout after sign-in:**
  - Call `useQuickActionRouting()`.
  - On iOS, set `QuickActions.setItems(quickActionItems(role))`.
  - Clear the items on sign-out.
- **Widgets:**
  - The app writes a snapshot. On iOS that goes to App Group UserDefaults, `widget.snapshot.v1`; on Android it goes through `requestWidgetUpdate`.
  - No long-lived token ever reaches the widget.
  - Agency money appears only for owner and admin.
  - The client name is `.privacySensitive()` on iOS.
- **Before submitting:** decide on the iPad orientation. `"orientation": "portrait"` and iPad multitasking conflict, so either allow every orientation or set `UIRequiresFullScreen`.

The full patch text, including both config plugins and the Swift file, came in the builder's report on 25 November 2026. Ask Claude for it, or regenerate it from this plan.

## Gaps

- **Producer and owner goal progress:** there's no route for it. `/api/app/goals` returns only the target.
- **The agency month:** the widget can't read `GET /api/app/agency/dashboard`, because that route writes (it runs the ledger sync). A lean read-only `GET /api/app/widget/today` would be a new route, and needs the owner's decision.
- **Siri:** can't place a call, which must always go through the call sheet. It can't speak the answer yet; it opens Callbacks instead.
- **Not compiled or seen yet:** the native patches, and the tablet layout on a real tablet. The tablet layout is covered by tests with a mocked window width.
