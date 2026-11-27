// Test doubles for native pieces that have no JS implementation under Jest.
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
// Reanimated 4 (the launch cover, the calm rise and the loading sheen). Its packaged mock needs the native worklets
// runtime, so tests get a still version of the few pieces the app uses: values land at once, nothing animates.
jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  const chain = () => { const c = { duration: () => c, delay: () => c, easing: () => c }; return c; };
  const Animated = { View, createAnimatedComponent: (c: unknown) => c };
  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (f: () => object) => f(),
    useReducedMotion: () => false,
    withTiming: (v: unknown) => v,
    withDelay: (_d: number, v: unknown) => v,
    withRepeat: (v: unknown) => v,
    cancelAnimation: () => undefined,
    Easing: { bezier: () => (t: number) => t, inOut: (f: unknown) => f, quad: (t: number) => t, linear: (t: number) => t },
    ReduceMotion: { System: "system", Always: "always", Never: "never" },
    FadeOut: chain(),
    FadeIn: chain(),
  };
});
