// ---------------------------------------------------------------------------
// Weather driver. Default is a two-harmonic sine model (daily + seasonal) so a
// full year runs believably without data files. TMY3 can replace this later by
// swapping `weatherAt` for a table lookup — the rest of the engine only reads
// the returned `Weather`.
// ---------------------------------------------------------------------------

import type { BuildingConfig, Weather } from '../types/domain'

const TWO_PI = Math.PI * 2

/** Moist-air enthalpy (Btu/lb dry air) from dry-bulb °F and relative humidity. */
export function enthalpyFrom(tempF: number, rhPct: number): number {
  // Saturation pressure (psia) via a compact Antoine-style fit, then humidity
  // ratio, then h = 0.240*T + W*(1061 + 0.444*T). Good enough for economizer
  // decisions and DCV explanations; not a metrology reference.
  const tC = ((tempF - 32) * 5) / 9
  const pSat = 0.61078 * Math.exp((17.27 * tC) / (tC + 237.3)) // kPa
  const pSatPsia = pSat * 0.145038
  const pv = (rhPct / 100) * pSatPsia
  const w = (0.62198 * pv) / (14.696 - pv) // humidity ratio lb/lb
  return 0.24 * tempF + w * (1061 + 0.444 * tempF)
}

export function weatherAt(minute: number, cfg: BuildingConfig): Weather {
  const w = cfg.weather
  const dayFraction = (minute % 1440) / 1440
  const yearFraction = (minute / (1440 * 365)) % 1

  // Coldest ~5am, warmest ~3pm → shift the daily peak to hour 15.
  const daily = Math.sin(TWO_PI * (dayFraction - 0.29))
  // Seasonal: coldest ~ mid-January (yearFraction 0), warmest ~ mid-July.
  const seasonal = -Math.cos(TWO_PI * yearFraction)

  const oatF = w.meanOatF + w.dailyAmplitudeF * daily + w.seasonalAmplitudeF * seasonal

  // Humidity loosely inverse to temperature swing, clamped to a sane band.
  const rhPct = clamp(w.meanRhPct - 18 * daily + 8 * seasonal, 15, 98)

  // Solar gain follows daylight: zero at night, peak at solar noon, scaled up
  // in summer. Used as a crude driver for zone solar loads.
  const solarRaw = Math.sin(Math.PI * clamp((dayFraction - 0.25) / 0.5, 0, 1))
  const seasonalSolar = 0.7 + 0.3 * seasonal
  const solarGainFactor = clamp(solarRaw * seasonalSolar, 0, 1)

  return { oatF, rhPct, enthalpy: enthalpyFrom(oatF, rhPct), solarGainFactor }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
