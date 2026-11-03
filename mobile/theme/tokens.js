// MtaaSense design tokens, shared with the web app (frontend/src/app/globals.css): warm neutral paper,
// dark ink, restrained forest green. Plain CommonJS so tailwind.config.js and TypeScript can both read it.

const colors = {
  paper: '#f7f5f0',
  surface: '#ffffff',
  sunken: '#f1eee7',
  line: '#e4dfd4',
  'line-strong': '#d1c9ba',
  ink: { DEFAULT: '#1d1b17', 2: '#555046', 3: '#878174' },
  accent: { DEFAULT: '#2f6b4f', hover: '#265a42', soft: '#e5eee8', ink: '#1e4a36' },
  warn: { DEFAULT: '#a86b12', soft: '#faf0dc', ink: '#7d520c' },
  danger: { DEFAULT: '#a8402e', soft: '#f7e5e0' },
  info: { DEFAULT: '#355f93', soft: '#e5edf6' },
  // Hazard categories, used consistently on badges, map markers and overlays.
  cat: { pothole: '#b4562f', road: '#8a6a3c', drain: '#2b6f78', flood: '#3b5fa3' },
  photo: '#16140f',
};

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
