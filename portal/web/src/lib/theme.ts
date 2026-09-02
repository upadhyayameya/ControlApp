// ---------------------------------------------------------------------------
// Reading design tokens from CSS at runtime.
//
// Charts need real colour values, not class names, and those values live in
// CSS custom properties so light and dark are one swap. This reads them back
// and re-reads on a theme change, so a chart drawn in light mode does not keep
// its light-mode ink after the viewer switches.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'

export interface ThemeTokens {
  ink: string
  ink2: string
  ink3: string
  line: string
  lineStrong: string
  surface: string
  good: string
  warn: string
  bad: string
  accent: string
}

const FALLBACK: ThemeTokens = {
  ink: '#101418',
  ink2: '#4A524E',
  ink3: '#78807A',
  line: '#DBDED8',
  lineStrong: '#BFC4BC',
  surface: '#FAFAF8',
  good: '#1F6F4A',
  warn: '#A8690C',
  bad: '#A32B1C',
  accent: '#0B5D66',
}

function read(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = styles.getPropertyValue(name).trim()
  // Tokens are stored as "R G B" triples so Tailwind can apply alpha to them.
  if (!/^\d+\s+\d+\s+\d+$/.test(raw)) return fallback
  return `rgb(${raw.split(/\s+/).join(', ')})`
}

function currentTokens(): ThemeTokens {
  if (typeof window === 'undefined') return FALLBACK
  const styles = getComputedStyle(document.documentElement)
  return {
    ink: read(styles, '--ink', FALLBACK.ink),
    ink2: read(styles, '--ink-2', FALLBACK.ink2),
    ink3: read(styles, '--ink-3', FALLBACK.ink3),
    line: read(styles, '--line', FALLBACK.line),
    lineStrong: read(styles, '--line-strong', FALLBACK.lineStrong),
    surface: read(styles, '--surface', FALLBACK.surface),
    good: read(styles, '--good', FALLBACK.good),
    warn: read(styles, '--warn', FALLBACK.warn),
    bad: read(styles, '--bad', FALLBACK.bad),
    accent: read(styles, '--accent', FALLBACK.accent),
  }
}

export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(currentTokens)

  useEffect(() => {
    const refresh = (): void => setTokens(currentTokens())
    refresh()

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', refresh)
    // The host can stamp data-theme on <html> after load, which no media query
    // reports; watching the attribute covers the explicit-choice case.
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      media.removeEventListener('change', refresh)
      observer.disconnect()
    }
  }, [])

  return tokens
}
