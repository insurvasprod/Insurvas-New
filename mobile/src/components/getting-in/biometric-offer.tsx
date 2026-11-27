import { Dialog } from "@/components/getting-in/dialog";
import { IOS } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Board A4 · Face ID next time, offered once over Home after the first good sign-in, only on a phone
 * with Face ID / a fingerprint set up. It sets the unlock preference (Settings › Face ID changes it);
 * the server's session rules are unchanged.
 */
export function BiometricOffer() {
  const { setup, finishSetup, setBiometricOn } = useSession();
  const choose = (on: boolean) => {
    void setBiometricOn(on);
    finishSetup("biometric");
  };
  const name = IOS ? "Face ID" : "your fingerprint";
  return (
    <Dialog visible={setup === "biometric"}
      title={IOS ? "Use Face ID to sign in?" : "Sign in with your fingerprint?"}
      body={`Next time, open Insurvas with ${name} instead of your password. Your agency’s two-step rule still applies every 30 days.`}
      actions={[
        { label: IOS ? "Use Face ID" : "Use fingerprint", bold: true, onPress: () => choose(true), testID: "biometric-yes" },
        { label: "Not now", onPress: () => choose(false), testID: "biometric-no" },
      ]} />
  );
}
