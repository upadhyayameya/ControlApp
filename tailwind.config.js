/** @type {import('tailwindcss').Config} */
// HBS palette: forest green, copper, warm cream. Dense operator-workstation look
// with first-class dark mode. Numeric readouts use the `mono` family.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // HBS brand
        forest: {
          50: '#eef4ef',
          100: '#d3e3d6',
          300: '#7fa587',
          500: '#2f6b3d', // primary forest green
          600: '#255733',
          700: '#1c4227',
          800: '#14301c',
          900: '#0d2013',
        },
        copper: {
          300: '#d99a6c',
          400: '#c97f4a',
          500: '#b56a33', // copper accent
          600: '#9a5526',
        },
        cream: {
          50: '#fbf8f1',
          100: '#f4eede',
          200: '#e7dcc4',
        },
        // Operator-workstation surfaces (dark)
        panel: {
          900: '#0f1512',
          800: '#151d18',
          700: '#1d271f',
          600: '#27332a',
          500: '#334437',
        },
        // BAS flow-line conventions
        flow: {
          chw: '#3b9ed6', // chilled water — blue
          hw: '#d64545', // hot water — red
          cw: '#7c8aa5', // condenser water — slate
          air: '#5bb98c', // air — green
          elec: '#e0b23a', // electrical — amber
        },
        alarm: {
          critical: '#e0533d',
          warning: '#e0a53a',
          info: '#3b9ed6',
          ok: '#5bb98c',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
