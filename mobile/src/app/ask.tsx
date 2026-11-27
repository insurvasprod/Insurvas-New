import { VoiceAnswerScreen } from "@/components/native/voice-answer";

/**
 * Board L5 · the spoken answer to "What's my next callback?" (insurvas://open?feature=next callback, or
 * insurvas://next-callback?ask=1). The screen checks the lock itself: nothing is read until the app is unlocked.
 */
export default function Ask() {
  return <VoiceAnswerScreen />;
}
