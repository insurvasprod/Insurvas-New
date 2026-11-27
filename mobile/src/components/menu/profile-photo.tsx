import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { Avatar, F } from "@/components/ui";
import { API_URL, ApiError, formRequest } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

/**
 * Board J3b's photo: the person's own profile picture (GET/POST /api/app/profile/avatar — the session's user only,
 * a JPG, PNG or WebP under 2 MB), else their gold initials. "Add a photo" takes one with the camera or from the
 * phone's photos; the server checks the file and keeps it.
 */
export function ProfilePhoto({ initials, size = 64 }: { initials: string; size?: number }) {
  const p = usePalette();
  const { refreshToken } = useSession();
  const [token, setToken] = useState<string | null>(null);
  const [version, setVersion] = useState(() => String(Date.now()));
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void refreshToken().then(setToken); }, [refreshToken]);

  const pick = async (from: "camera" | "photos") => {
    setError(null);
    if (from === "camera") {
      const allowed = await ImagePicker.requestCameraPermissionsAsync();
      if (!allowed.granted) {
        Alert.alert("Camera is off for Insurvas", "Taking a photo needs the camera. Turn it on in the phone’s Settings, then try again.", [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
        ]);
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, allowsEditing: true, aspect: [1, 1], exif: false };
    const shot = from === "camera" ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(options);
    if (shot.canceled || !shot.assets?.length) return;
    const a = shot.assets[0];
    const type = a.mimeType === "image/png" ? "image/png" : a.mimeType === "image/webp" ? "image/webp" : "image/jpeg";
    setBusy(true);
    try {
      const fresh = await refreshToken();
      if (!fresh) throw new ApiError(401, { error: "Sign in again to change your photo." });
      const form = new FormData();
      // React Native's FormData reads a file from {uri, name, type}.
      form.append("file", { uri: a.uri, name: a.fileName ?? `photo.${type.split("/")[1]}`, type } as unknown as Blob);
      // The app's own headers and the M8 update check (lib/api.ts formRequest).
      await formRequest("/api/app/profile/avatar", form, { method: "POST", token: fresh });
      setToken(fresh);
      setVersion(String(Date.now()));
      setHasPhoto(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your photo could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const choose = () => Alert.alert(hasPhoto ? "Change your photo" : "Add a photo", undefined, [
    { text: "Take a photo", onPress: () => void pick("camera") },
    { text: "Choose from photos", onPress: () => void pick("photos") },
    { text: "Cancel", style: "cancel" },
  ]);

  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      <View style={{ width: size, height: size }}>
        <Avatar initials={initials} size={size} />
        {token && hasPhoto !== false ? (
          <Image testID="profile-photo" style={{ position: "absolute", width: size, height: size, borderRadius: size / 2 }} contentFit="cover" cachePolicy="none"
            source={{ uri: `${API_URL}/api/app/profile/avatar?v=${version}`, headers: { authorization: `Bearer ${token}`, "x-insurvas-client": "app" } }}
            onLoad={() => setHasPhoto(true)} onError={() => setHasPhoto(false)} />
        ) : null}
      </View>
      <Pressable testID="profile-add-photo" accessibilityRole="button" onPress={choose} disabled={busy} hitSlop={8}>
        {busy ? <ActivityIndicator color={p.greenInk} /> : <Text style={{ fontFamily: F.s, fontSize: 15, color: p.greenInk }}>{hasPhoto ? "Change photo" : "Add a photo"}</Text>}
      </Pressable>
      {error ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad, textAlign: "center" }}>{error}</Text> : null}
    </View>
  );
}
