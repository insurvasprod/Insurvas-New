import { globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // mobile/ is the Expo app: its own package, lint (npx expo lint) and typecheck. .claude/ holds agent skills
  // (third-party scripts), not app code.
  globalIgnores(["insurvas-demo-video/**", "mobile/**", ".claude/**"]),
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
