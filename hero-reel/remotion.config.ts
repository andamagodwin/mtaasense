import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);

// Remotion's bundled Chrome Headless Shell crashes at startup on some macOS releases (seen on macOS 26.3:
// "Invalid file descriptor to ICU data received"). Point REMOTION_CHROME at an installed Chrome to render
// with that instead.
const chrome = process.env.REMOTION_CHROME;
if (chrome) {
  Config.setBrowserExecutable(chrome);
  Config.setChromeMode("chrome-for-testing");
}
