// ---------------------------------------------------------------------------
// Connection validation. Returns a plain-English reason when a wire doesn't
// make physical sense, so the trainee learns *why* — "a boiler makes hot
// water; it can't feed a chilled-water coil" rather than a red X.
// ---------------------------------------------------------------------------

import type { EquipmentNode, Port, SystemConfig } from '../types/domain'

export interface ValidationResult {
  ok: boolean
  reason?: string
}

const MEDIUM_LABEL: Record<string, string> = {
  chw: 'chilled water',
  hw: 'hot water',
  cw: 'condenser water',
  sa: 'supply air',
  ra: 'return air',
  oa: 'outside air',
  ea: 'exhaust air',
  elec: 'electrical',
}

export function validateConnection(
  config: SystemConfig,
  source: EquipmentNode,
  sourcePort: Port,
  target: EquipmentNode,
  targetPort: Port,
): ValidationResult {
  if (source.id === target.id) return { ok: false, reason: 'You cannot connect a device to itself.' }

  // Kind must match: air-to-air, water-to-water, electrical-to-electrical.
  if (sourcePort.kind !== targetPort.kind) {
    return {
      ok: false,
      reason: `Can't join a ${sourcePort.kind} port to a ${targetPort.kind} port — those are different systems. Match air to air, water to water, electrical to electrical.`,
    }
  }

  // Direction: an output must feed an input.
  if (sourcePort.direction === targetPort.direction) {
    return {
      ok: false,
      reason: `Both ends are ${sourcePort.direction === 'out' ? 'outputs' : 'inputs'}. Connect an outlet to an inlet — for example a supply port to a return/coil port.`,
    }
  }

  // Water sub-medium must match: no boiler → CHW loop.
  if (sourcePort.kind === 'water' && sourcePort.medium !== targetPort.medium) {
    const a = MEDIUM_LABEL[sourcePort.medium]
    const b = MEDIUM_LABEL[targetPort.medium]
    return {
      ok: false,
      reason: `${source.name} is on the ${a} loop but ${target.name}'s port is ${b}. ${crossLoopHint(source, target, sourcePort.medium, targetPort.medium)}`,
    }
  }

  // No duplicate identical connection.
  const dup = config.connections.find(
    (c) =>
      (c.source === source.id && c.sourcePort === sourcePort.id && c.target === target.id && c.targetPort === targetPort.id) ||
      (c.source === target.id && c.sourcePort === targetPort.id && c.target === source.id && c.targetPort === sourcePort.id),
  )
  if (dup) return { ok: false, reason: 'These two ports are already connected.' }

  return { ok: true }
}

function crossLoopHint(source: EquipmentNode, _target: EquipmentNode, sm: string, tm: string): string {
  if ((sm === 'hw' && tm === 'chw') || (sm === 'chw' && tm === 'hw')) {
    return 'Hot-water and chilled-water loops are separate; a heat exchanger is the only thing that should bridge them.'
  }
  if (source.category === 'boiler' && tm === 'chw') {
    return 'A boiler produces hot water — it cannot supply a chilled-water coil.'
  }
  if (source.category === 'chiller' && tm === 'hw') {
    return 'A chiller produces chilled water — it cannot supply a hot-water coil.'
  }
  return 'Route each device to the loop its media actually belongs to.'
}
