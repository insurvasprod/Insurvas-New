// Windows only: the app's C++ build (React Native's codegen for the native libraries) writes object files whose
// paths repeat the whole source path, and past 260 characters ninja stops ("Filename longer than 260 characters").
// Moving the app module's CMake staging folder to a short absolute path keeps them under the limit. Linux and macOS
// builds (EAS) are left exactly as Expo generates them.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// insurvas: short CMake staging dir (Windows)";

module.exports = function withWindowsShortCmakeDir(config) {
  if (process.platform !== "win32") return config;
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARK)) {
      cfg.modResults.contents += `\n${MARK}\nandroid.externalNativeBuild.cmake.buildStagingDirectory = new File("C:/d")\n`;
    }
    return cfg;
  });
};
