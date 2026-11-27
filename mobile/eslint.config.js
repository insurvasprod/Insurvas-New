// The Expo app's own lint (npx expo lint). The web's eslint.config.mjs one level up ignores mobile/.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  { ignores: ["dist/*", ".expo/*", "node_modules/*"] },
]);
