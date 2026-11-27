# Insurvas for iOS and Android

The phone app, built with Expo (SDK 58, React Native 0.88, expo-router). The screens follow the mobile board at
[`docs/design/mobile-v1/index.html`](../docs/design/mobile-v1/index.html). The settled decisions and the three
releases are listed in its section 00. This folder is **release 1**:

- sign-in, the code, Face ID / fingerprint unlock, lock after 5 minutes away
- homes for producer, setter and assistant
- search
- Calls: incoming transfers, the dialer, callbacks
- Leads and the lead page, with the call flow
- Inbox and push
- Menu: settings, signed-in devices, switch workspace, the computer hand-off

## How it talks to the server

Every screen calls the web app's own `/api/app/*` routes, so roles, plans, money rules and compliance are decided
by the same code as on the web. The phone never decides who may call or see cost.

- **Sign-in:** `/api/app/auth/mobile/{login,verify-2fa,refresh,logout,switch-workspace,sessions}` wrap the web's
  routes and return tokens instead of cookies (`lib/tenantAuth/appSession.ts`).
- **The session token:** it is the web's session token with a `cli: "app"` mark. It is sent as
  `Authorization: Bearer …`, and `requireTenant` accepts a header token only with that mark.
- **Refresh:** the refresh token lasts 30 days from sign-in and is never extended. Ending the session (sign out,
  Signed-in devices, sign out everywhere) ends it on the next refresh.
- **Storage:** both tokens live in the Keychain / Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
- **Calls:** a call is the web dialer's flow:
  1. the dialer panel
  2. the disclosure, word for word
  3. `POST attempt`
  4. `POST attempt/:id/click`, where the server re-runs suppression, DNC, litigators, the calling window and
     consent
  5. only then the phone's own dialer
  6. the outcome when you come back
- **Push:** every bell row also goes to the recipient's phones (`lib/push/*`). It follows the recipient's own
  choice in Settings › Notifications, including quiet hours. Transfers and callbacks due ring on the `calls`
  channel.

## Run it

```bash
npm install
npx expo start            # phone: Expo Go or a development build
npx expo start --web      # the web preview (development only)
```

Set `EXPO_PUBLIC_API_URL` to the web app's address. The default is `http://localhost:3000`.

The web preview calls the API from `localhost:8081`. The web app's proxy allows that origin in development only
(`lib/security/appPreviewCors.ts`).

To sign the preview in without typing a password:

```bash
node --env-file=.env.local scripts/mint-session.mjs tenant --email <addr> --app --js
```

Run it from the repository root, then paste the printed line into the preview's console.

Face ID, push and the Keychain need a development build (`npx expo run:ios|android` or
`eas build --profile development`). Expo Go and the web preview skip them.

## Before the first store build

- **Push:** create the EAS project (`npx eas-cli@latest init`), which adds `extra.eas.projectId`. Then add the APNs
  key and the FCM credentials.
- **Migration:** apply `supabase/migrations/20261124100000_app_push_devices.sql`. Until then sign-in and every
  screen work, without push.
- **Icons:** replace the template icons in `assets/images` with the Insurvas isotype.
- **App IDs:** confirm the bundle ID and package name (`com.insurvas.app` in `app.json`).

## Checks

```bash
npm run check             # typecheck + lint + unit tests (Jest + React Native Testing Library v14)
npx expo-doctor
```

Unit and component tests live next to the code in `__tests__` folders, never under `src/app` (every file
there is a screen). The call sheet's tests pin the compliance order: the phone dials only after the server's
attempt and click checks pass, never on a refusal or a blocking disclosure.

## Test on Android (Windows, set up 2026-11-24)

Installed in the user profile, no admin:

- **Java:** JDK 17 in `%LOCALAPPDATA%\Programs\jdk17`.
- **Android SDK:** in `%LOCALAPPDATA%\Android\Sdk`, with platform-tools, the emulator and Android 15.
- **Emulator:** an Android 15 (API 35) Pixel 7 virtual device named `Insurvas_Pixel`, with 4 GB of RAM (2 GB let
  Android kill the test driver mid-run). The emulator reports WHPX hardware acceleration as usable.
- **Maestro:** the end-to-end test runner, in `%LOCALAPPDATA%\Programs\maestro`.

`JAVA_HOME`, `ANDROID_HOME` and their `bin` folders are on the user PATH (new terminals pick them up).

1. **Start the emulator:**

   ```bash
   emulator -avd Insurvas_Pixel
   ```

2. **Start the web app:** run `npm run dev` from the repo root (the API on port 3000).
3. **Start Metro:**

   ```bash
   npm --prefix mobile run android
   ```

   Expo installs Expo Go on the emulator and opens the app. `.claude/launch.json` has this as `mobile-android`.
4. **Run the end-to-end flows:**

   ```bash
   powershell -File mobile/scripts/e2e-android.ps1
   ```

   That runs flow `01`, which needs no account. Add `-SignedIn -Email <test account>` to also run the read-only
   signed-in walk (`03`). It signs in with development-only tokens minted from `.env.local`, so no password is
   typed or stored. Screenshots land in `mobile/e2e/screenshots`.

Things that are different on the emulator:

- **Reaching this PC:** the emulator reaches this PC at `10.0.2.2`. The app's development API address on Android
  is `http://10.0.2.2:3000`, and the flows open `exp://10.0.2.2:8081`.
- **Keyboard:** Gboard's stylus toolbar covers forms on an emulator. The script turns stylus handwriting off.
- **Tapping tabs:** tabs are tapped by position, because every tab keeps its screen mounted and the same words
  appear on more than one screen.
- **Push:** remote push does not run in Expo Go (Android, SDK 53 and later). It needs a development build.

## Test on iOS

The iOS Simulator only runs on a Mac (Xcode). On this Windows PC there are two ways to see the app on iOS:

1. **Expo Go on a real iPhone (free, set up 2026-11-24):**
   - Install Expo Go from the App Store.
   - Put the iPhone on the same Wi-Fi as this PC.
   - With the web app (port 3000) and Metro (`npm --prefix mobile run android`, or `npx expo start` in `mobile/`)
     running, open the iPhone Camera and point it at the QR code Metro prints. It encodes
     `exp://<this PC's Wi-Fi IP>:8081`. You can also type that address in Expo Go under "Enter URL manually".
   - The app finds the API by itself: in development it calls port 3000 on the same computer its code came from.
     `EXPO_PUBLIC_API_URL` is only for builds.
   - Windows Firewall must allow Node on this network. On this PC it does: the rules allow it for both Private and
     Public networks.
   - In Expo Go the app signs in (tokens in the Keychain) and every screen works. Two things need a development
     build: Face ID, because Expo Go has no Face ID permission and the unlock asks for the phone's passcode
     instead, and remote push.
2. **Expo Simulators, Expo's cloud iPhone simulator:** it needs an Expo account on a paid plan
   (`npx eas-cli@latest login`), the EAS project (`npx eas-cli@latest init`) and a development build made on EAS.
   The `eas-simulator` skill in `.claude/skills` has the exact steps. Sessions are billed by Expo.

The same Maestro flows run on an iOS simulator from a Mac; replace `10.0.2.2` with `127.0.0.1`.

### iPhone simulator on this PC, free (Appetize, set up 2026-11-24)

The Expo project is `@rinorgllareva/insurvas`, and Expo's free plan builds the app. Appetize's free tier streams a
real iOS simulator into the browser. It has limited minutes a month.

1. **Open the tunnel:**

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   `cloudflared.exe` is in `%LOCALAPPDATA%\Programs\cloudflared`. The command prints a
   `https://….trycloudflare.com` address. The simulator runs in the cloud, so it reaches the local API through
   that address. Close the tunnel when you're done.
2. **Point the build at it:** put that address in `eas.json` › `build.simulator-cloud.env.EXPO_PUBLIC_API_URL`. The
   address changes every time the tunnel starts.
3. **Build:**

   ```bash
   EAS_NO_VCS=1 npx eas-cli@latest build --profile simulator-cloud --platform ios
   ```

   Run it from `mobile/`. It takes about 8 minutes. `EAS_NO_VCS=1` uploads only `mobile/`, never the rest of the
   repository.
4. **Upload to Appetize:** download the build's `.tar.gz` and upload it
   (`POST https://api.appetize.io/v1/apps`, header `X-API-KEY`, `file` and `platform=ios`). To update the same
   Appetize app instead of creating a new one, post to `/v1/apps/<publicKey>`.
5. **Open the simulator:**
   `https://appetize.io/app/<publicKey>?device=iphone16pro&appearance=dark`

The JavaScript is built in, so every code change needs steps 3–4 again. The paid Expo plan's own cloud simulator
live-reloads instead.
