import { globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // mobile/ is the Expo app: its own package, lint (npx expo lint) and typecheck.
  globalIgnores(["insurvas-demo-video/**", "mobile/**"]),
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
