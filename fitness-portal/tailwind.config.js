/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0d1117', soft: '#161b22', line: '#232c38' },
        accent: { DEFAULT: '#f97316', dim: '#c2410c' },
        good: '#22c55e',
        warn: '#eab308',
        bad: '#ef4444',
      },
      fontFamily: { sans: ['ui-sans-serif', 'system-ui', 'Inter', 'sans-serif'] },
    },
  },
  plugins: [],
}
