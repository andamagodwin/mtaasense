const { colors, fontFamily } = require('./theme/tokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './components/**/*.{js,ts,tsx}', './lib/**/*.{js,ts,tsx}'],

  presets: [require('nativewind/preset')],
  theme: {
    extend: { colors, fontFamily },
  },
  // `font-medium`, `font-semibold` and `font-bold` switch Manrope families (see theme/tokens.js). A fontWeight
  // on top of a single-weight custom font makes Android synthesise a fake bold, so weight utilities are off.
  corePlugins: { fontWeight: false },
  plugins: [],
};
