// ---------------------------------------------------------------------------
// Default control-sequence bundles per equipment category. Every sequence
// ships disabled-or-fixed so a freshly placed unit behaves predictably; the
// engineer enables resets and DCV as they build up the story.
// ---------------------------------------------------------------------------

import type { ControlSequences, EquipmentCategory } from '../types/domain'

export function defaultSequences(category: EquipmentCategory): ControlSequences {
  switch (category) {
    case 'ahu':
    case 'rtu':
      return {
        dischargeAirReset: {
          enabled: false,
          strategy: 'fixed',
          fixedSetpointF: 55,
          oatLowF: 55,
          oatHighF: 75,
          satAtLowF: 60,
          satAtHighF: 55,
        },
        economizer: {
          enabled: true,
          type: 'dry-bulb',
          minOaPct: 15,
          highLimitOatF: 65,
          highLimitEnthalpy: 28,
        },
        staticPressureReset: {
          enabled: false,
          strategy: 'fixed',
          fixedSetpointInWc: 1.5,
          minSetpointInWc: 0.6,
          maxSetpointInWc: 2.0,
        },
        dcv: { enabled: false, co2SetpointPpm: 900, minOaPct: 10, maxOaPct: 40 },
        schedule: weekdaySchedule(),
        optimalStart: {
          enabled: false,
          learnedWarmupRate: 4,
          learnedCooldownRate: 5,
          maxLeadTimeMin: 180,
        },
      }
    case 'chiller':
      return {
        // Disabled by default; when enabled (OAT-based) this curve holds ~44°F
        // on a hot day but rises toward 54°F as OAT falls — so a drifted OAT
        // sensor that reads low will hold chilled water too warm for the load.
        chwReset: {
          enabled: false,
          strategy: 'oat',
          fixedSetpointF: 44,
          oatLowF: 60,
          oatHighF: 95,
          satAtLowF: 54,
          satAtHighF: 44,
        },
        staging: staging('chw-bank'),
      }
    case 'boiler':
      return {
        hwReset: { ...waterReset(140, 120, 160), strategy: 'oat' },
        staging: staging('hw-bank'),
      }
    case 'coolingTower':
      return { cwReset: waterReset(75, 68, 85) }
    case 'pump':
      return { staging: staging('pump-bank') }
    case 'vav':
      return {
        setpoints: { zoneCoolingF: 74, zoneHeatingF: 70, deadbandF: 2 },
        schedule: weekdaySchedule(),
      }
    case 'zone':
      return {
        setpoints: { zoneCoolingF: 74, zoneHeatingF: 70, deadbandF: 2 },
        schedule: weekdaySchedule(),
      }
    case 'wshp':
    case 'fcu':
      return { setpoints: { zoneCoolingF: 74, zoneHeatingF: 70, deadbandF: 2 } }
    default:
      return {}
  }
}

function weekdaySchedule() {
  return {
    enabled: true,
    weekdayStartHr: 6,
    weekdayEndHr: 18,
    weekendStartHr: 8,
    weekendEndHr: 14,
    weekendOccupied: false,
    override: 'none' as const,
  }
}

function waterReset(fixed: number, lo: number, hi: number) {
  return {
    enabled: false,
    strategy: 'fixed' as const,
    fixedSetpointF: fixed,
    oatLowF: 55,
    oatHighF: 90,
    satAtLowF: hi,
    satAtHighF: lo,
  }
}

function staging(bankId: string) {
  return {
    enabled: true,
    order: 0,
    bankId,
    stageUpLoadPct: 85,
    stageDownLoadPct: 35,
    minRuntimeMin: 15,
    minOffTimeMin: 10,
    rotationHours: 168,
  }
}
