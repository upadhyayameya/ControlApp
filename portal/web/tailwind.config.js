/** @type {import('tailwindcss').Config} */
// Every colour resolves through a CSS custom property defined in index.css, so
// light and dark are one token swap rather than two sets of classes. The
// palette is deliberately monochrome: the only hue in the product is
// compliance status, which means colour on this screen always carries
// information.
const withAlpha = (variable) => `rgb(var(${variable}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: withAlpha('--paper'),
        surface: withAlpha('--surface'),
        raised: withAlpha('--raised'),
        line: withAlpha('--line'),
        'line-strong': withAlpha('--line-strong'),
        ink: withAlpha('--ink'),
        'ink-2': withAlpha('--ink-2'),
        'ink-3': withAlpha('--ink-3'),
        // Per-tenant branding, kept out of the core palette on purpose: it is
        // set at runtime from the organization record and must never be load
        // bearing for meaning.
        accent: withAlpha('--accent'),
        // The only hues in the product.
        good: withAlpha('--good'),
        'good-soft': withAlpha('--good-soft'),
        warn: withAlpha('--warn'),
        'warn-soft': withAlpha('--warn-soft'),
        bad: withAlpha('--bad'),
        'bad-soft': withAlpha('--bad-soft'),
        inert: withAlpha('--inert'),
      },
      fontFamily: {
        display: ['Archivo', 'Helvetica Neue', 'Arial', 'sans-serif'],
        sans: ['Public Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // A single scale, used everywhere. Display sizes carry tight tracking
        // because Archivo opens up badly at large sizes on default tracking.
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em' }],
        tiny: ['0.75rem', { lineHeight: '1.1rem' }],
        base: ['0.875rem', { lineHeight: '1.4rem' }],
        body: ['0.9375rem', { lineHeight: '1.55rem' }],
        lead: ['1.0625rem', { lineHeight: '1.7rem' }],
        h3: ['1.125rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        h2: ['1.5rem', { lineHeight: '1.85rem', letterSpacing: '-0.02em' }],
        h1: ['2rem', { lineHeight: '2.25rem', letterSpacing: '-0.025em' }],
        figure: ['2.75rem', { lineHeight: '1', letterSpacing: '-0.035em' }],
        'figure-lg': ['4rem', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
      },
      borderRadius: {
        // Restrained: a small radius reads as considered, a large one as a
        // template. Instruments (bars, tracks) stay square.
        DEFAULT: '3px',
        sm: '2px',
        md: '4px',
        lg: '6px',
      },
      spacing: {
        rail: '15rem',
      },
      transitionTimingFunction: {
        instrument: 'cubic-bezier(0.16, 0.84, 0.44, 1)',
      },
    },
  },
  plugins: [],
}
