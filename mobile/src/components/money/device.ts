import { Alert, Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";

import { confirmItsYou } from "@/components/applications/biometric";
import { API_URL, ApiError, formRequest } from "@/lib/api";

/**
 * What the Money screens ask of the phone itself: a fresh fingerprint or Face ID before any approval or payment
 * (the board's rule for G3b, G3c, G4), the private statement PDF the web already makes (opened in the phone's own
 * viewer, which shares it), and a receipt photo from the camera (G5) sent to the web's own receipt upload.
 */

/** A fresh check before money moves; the platform draws its own prompt. False when it failed or was cancelled. */
export async function approveWithBiometrics(title: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const result = await confirmItsYou(title);
  if (result.ok) return result;
  // The applications wording speaks of hidden numbers; here nothing was approved.
  return { ok: false, why: result.why ? "That didn’t match, so nothing was approved." : "" };
}

/**
 * The statement's PDF, as the web downloads it (GET …/statements/<run>?format=pdf), into the phone's cache, then
 * opened in Quick Look (iOS) or the PDF viewer (Android): both carry the platform's own Share. The file stays in
 * the app's cache; nothing is written anywhere else.
 */
export async function openStatementPdf(input: { token: string; runId: string; name: string }): Promise<void> {
  const file = new File(Paths.cache, `${input.name.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`);
  try {
    const got = await File.downloadFileAsync(`${API_URL}/api/app/agency/statements/${input.runId}?format=pdf`, file, {
      idempotent: true,
      headers: { accept: "application/pdf", "x-insurvas-client": "app", authorization: `Bearer ${input.token}` },
    });
    // A refused request still writes its (JSON) answer: a real statement is a PDF of a few kilobytes at least.
    if (!got.exists || got.size < 500) throw new ApiError(404, { error: "That statement could not be opened." });
    await got.preview();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, { error: "The statement didn’t download. Check your signal and try again." });
  }
}

export type Photo = { uri: string; name: string; type: string };

/**
 * One receipt from the camera, or null when the person backs out or the camera is refused (the refusal opens a
 * dialog that can open the phone's Settings, as the case scanner does).
 */
export async function snapReceipt(): Promise<Photo | null> {
  const allowed = await ImagePicker.requestCameraPermissionsAsync();
  if (!allowed.granted) {
    Alert.alert("Camera is off for Insurvas", "Snapping a receipt needs the camera. Turn it on in the phone’s Settings, then try again.", [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
    ]);
    return null;
  }
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, allowsEditing: Platform.OS === "android", exif: false });
  if (shot.canceled || !shot.assets?.length) return null;
  const a = shot.assets[0];
  const type = a.mimeType === "image/png" ? "image/png" : "image/jpeg";
  return { uri: a.uri, name: a.fileName ?? `receipt.${type === "image/png" ? "png" : "jpg"}`, type };
}

/**
 * The receipt onto its expense: the web's own upload (PATCH /api/app/accounting/expenses/<id>, multipart `file`;
 * PDF, PNG or JPEG up to 10 MB). The session's JSON helper cannot carry a file, so this sends its own request with
 * the same Bearer token and app mark.
 */
export async function attachReceipt(input: { token: string; expenseId: string; photo: Photo }): Promise<void> {
  const form = new FormData();
  // React Native's FormData reads a file from {uri, name, type}; the DOM typing does not know that shape.
  form.append("file", input.photo as unknown as Blob);
  // The app's own headers and the M8 update check (lib/api.ts formRequest).
  await formRequest(`/api/app/accounting/expenses/${input.expenseId}`, form, { method: "PATCH", token: input.token });
}
