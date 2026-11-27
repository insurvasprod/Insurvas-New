import { Alert, Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { formRequest } from "@/lib/api";

/**
 * Pages for a carrier requirement (board E6b). The board draws the platform document scanners
 * (VisionKit on iOS, the ML Kit scanner on Android); neither is in the app yet (a native module and a
 * new development build), so each page is a camera photo through expo-image-picker. Android crops on
 * capture; iOS's picker can only crop to a square, which would cut a letter page, so iOS takes the
 * full photo.
 */
export type Page = { uri: string; name: string; type: string };

function asPage(asset: ImagePicker.ImagePickerAsset, n: number): Page {
  const type = asset.mimeType ?? "image/jpeg";
  return { uri: asset.uri, name: asset.fileName ?? `page-${n}.${type === "image/png" ? "png" : "jpg"}`, type };
}

/**
 * One page from the camera, or null when the person backs out or the camera is refused. A refusal is
 * answered with a dialog that can open the phone's Settings (a passing toast is too easy to miss).
 */
export async function takePage(n: number): Promise<Page | null> {
  const allowed = await ImagePicker.requestCameraPermissionsAsync();
  if (!allowed.granted) {
    Alert.alert("Camera is off for Insurvas", "Scanning a page needs the camera. Turn it on in the phone’s Settings, then try again.", [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
    ]);
    return null;
  }
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, allowsEditing: Platform.OS === "android", exif: false });
  if (shot.canceled || !shot.assets?.length) return null;
  return asPage(shot.assets[0], n);
}

/**
 * Where the pages go: the requirement on its attempt (app/api/app/applications/attempts/[id]/
 * requirements/[requirementId]/documents/route.ts). The server keeps each page privately, and on the
 * last one hands the requirement back to the carrier, in progress, with the note.
 */
export function documentsPath(attemptId: string, requirementId: string): string {
  return `/api/app/applications/attempts/${attemptId}/requirements/${requirementId}/documents`;
}

/**
 * One page a request (a phone photo is a few MB; hosted functions take only so much in one body),
 * multipart: the page as `file`, its place (`page`, `pages`) and, with the last, the note. The
 * session's JSON helper cannot carry files, so this sends its own request with the same Bearer token
 * and app mark the helper uses. `from` skips the pages already sent by an earlier try; `onSent` says
 * each one that arrived, so a retry after a dropped signal never sends a page twice.
 */
export async function sendPages(input: { token: string; attemptId: string; requirementId: string; pages: Page[]; note: string; from?: number; onSent?: (sent: number) => void }): Promise<void> {
  const total = input.pages.length;
  for (let i = input.from ?? 0; i < total; i++) {
    const form = new FormData();
    // React Native's FormData reads a file from {uri, name, type}; the DOM typing does not know that shape.
    form.append("file", input.pages[i] as unknown as Blob);
    form.append("page", String(i + 1));
    form.append("pages", String(total));
    if (i === total - 1 && input.note.trim()) form.append("note", input.note.trim());
    // The app's own headers and the M8 update check (lib/api.ts formRequest).
    await formRequest(documentsPath(input.attemptId, input.requirementId), form, { method: "POST", token: input.token });
    input.onSent?.(i + 1);
  }
}
