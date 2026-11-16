// Category glyphs and flow-color helpers shared across the canvas UI.
import type { EquipmentCategory, PortMedium } from '../types/domain'

export const FLOW_COLOR: Record<string, string> = {
  chw: '#3b9ed6',
  hw: '#d64545',
  cw: '#7c8aa5',
  sa: '#5bb98c',
  ra: '#8fc1a9',
  oa: '#5bb98c',
  ea: '#a0a8b0',
  elec: '#e0b23a',
}

export function mediumColor(medium: PortMedium): string {
  return FLOW_COLOR[medium] ?? '#888'
}

export const CATEGORY_ICON: Record<EquipmentCategory, string> = {
  chiller: '❄️',
  boiler: '🔥',
  ahu: '🌀',
  rtu: '🏢',
  fcu: '💨',
  wshp: '♻️',
  hx: '⇌',
  pump: '⚙️',
  coolingTower: '🗼',
  vav: '🎚️',
  zone: '🏠',
  sensor: '📟',
  vfd: '⚡',
  other: '⬚',
}

/** Whether a category shows a spinning-rotor animation when running. */
export function hasRotor(category: EquipmentCategory): boolean {
  return ['chiller', 'boiler', 'ahu', 'rtu', 'fcu', 'wshp', 'pump', 'coolingTower'].includes(category)
}
