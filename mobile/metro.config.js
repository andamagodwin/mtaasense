// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */

const config = getDefaultConfig(__dirname);

// The colour palette lives outside the app, in ../theme/colors.js, so the website can share it.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../theme')];

module.exports = withNativeWind(config, { input: './global.css' });
