// MtaaSense design tokens. Colours come from the palette shared with the website (theme/colors.js at the repo
// root; Metro watches that folder, see metro.config.js). Plain CommonJS so tailwind.config.js and TypeScript
// can both read it.

const { colors } = require('../../theme/colors');

// Each Manrope weight is its own font family on React Native, so weights are picked by family name.
const fontFamily = {
  sans: ['Manrope_400Regular'],
  medium: ['Manrope_500Medium'],
  semibold: ['Manrope_600SemiBold'],
  bold: ['Manrope_700Bold'],
  extrabold: ['Manrope_800ExtraBold'],
  mono: ['IBMPlexMono_500Medium'],
};

module.exports = { colors, fontFamily };
