/** @type {import('tailwindcss').Config} */
// Shares the HBS palette with the BAS trainer at the repository root — forest
// green, copper, warm cream — but light-first rather than dark: this is a
// customer-facing document, not an operator workstation.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#eef4ef',
          100: '#d3e3d6',
          200: '#b3cfb8',
          300: '#7fa587',
          500: '#2f6b3d',
          600: '#255733',
          700: '#1c4227',
          800: '#14301c',
          900: '#0d2013',
        },
        copper: {
          100: '#f7e7d8',
          300: '#d99a6c',
          400: '#c97f4a',
          500: '#b56a33',
          600: '#9a5526',
        },
        cream: {
          50: '#fbf8f1',
          100: '#f4eede',
          200: '#e7dcc4',
          300: '#d6c8a8',
        },
        status: {
          compliant: '#2f6b3d',
          'at-risk': '#c98a1f',
          'non-compliant': '#b4392a',
          exempt: '#6b7280',
          'insufficient-data': '#8a8578',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
