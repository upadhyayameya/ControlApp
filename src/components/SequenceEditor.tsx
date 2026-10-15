// ---------------------------------------------------------------------------
// Control-sequence editor. Renders whichever sequences a node carries, each
// with an enable toggle and its editable parameters. Edits are pushed straight
// to the running engine so the trainee watches consequences appear live.
// ---------------------------------------------------------------------------

import type { ControlSequences, EquipmentNode } from '../types/domain'
import { useStore } from '../state/store'
import { NumberField, Row, Section, Select, Toggle } from './fields'

export function SequenceEditor({ node }: { node: EquipmentNode }) {
  const updateSequences = useStore((s) => s.updateSequences)
  const seq = node.sequences

  const patch = (p: Partial<ControlSequences>) => updateSequences(node.id, { ...seq, ...p })

  const anySeq =
    seq.setpoints ||
    seq.dischargeAirReset ||
    seq.economizer ||
    seq.staticPressureReset ||
    seq.chwReset ||
    seq.hwReset ||
    seq.cwReset ||
    seq.schedule ||
    seq.dcv ||
    seq.staging ||
    seq.optimalStart

  if (!anySeq) {
    return <div className="px-3 py-3 text-[11px] text-forest-300">This device has no control sequences.</div>
  }

  return (
    <div>
      {seq.setpoints && (
        <Section title="Zone Setpoints">
          <Row label="Cooling">
            <NumberField value={seq.setpoints.zoneCoolingF} unit="°F" onChange={(v) => patch({ setpoints: { ...seq.setpoints!, zoneCoolingF: v } })} />
          </Row>
          <Row label="Heating">
            <NumberField value={seq.setpoints.zoneHeatingF} unit="°F" onChange={(v) => patch({ setpoints: { ...seq.setpoints!, zoneHeatingF: v } })} />
          </Row>
          <Row label="Deadband">
            <NumberField value={seq.setpoints.deadbandF} unit="°F" onChange={(v) => patch({ setpoints: { ...seq.setpoints!, deadbandF: v } })} />
          </Row>
        </Section>
      )}

      {seq.dischargeAirReset && (
        <Section
          title="Discharge Air Temp Reset"
          right={<Toggle checked={seq.dischargeAirReset.enabled} onChange={(v) => patch({ dischargeAirReset: { ...seq.dischargeAirReset!, enabled: v } })} />}
        >
          <Row label="Strategy">
            <Select
              value={seq.dischargeAirReset.strategy}
              options={[
                { value: 'fixed', label: 'Fixed' },
                { value: 'oat', label: 'OAT-based' },
                { value: 'trim-respond', label: 'Trim & Respond' },
              ]}
              onChange={(v) => patch({ dischargeAirReset: { ...seq.dischargeAirReset!, strategy: v } })}
            />
          </Row>
          {seq.dischargeAirReset.strategy === 'fixed' ? (
            <Row label="Setpoint">
              <NumberField value={seq.dischargeAirReset.fixedSetpointF} unit="°F" onChange={(v) => patch({ dischargeAirReset: { ...seq.dischargeAirReset!, fixedSetpointF: v } })} />
            </Row>
          ) : (
            <>
              <Row label="OAT low → high">
                <NumberField width="w-12" value={seq.dischargeAirReset.oatLowF} onChange={(v) => patch({ dischargeAirReset: { ...seq.dischargeAirReset!, oatLowF: v } })} />
                <NumberField width="w-12" value={seq.dischargeAirReset.oatHighF} unit="°F" onChange={(v) => patch({ dischargeAirReset: { ...seq.dischargeAirReset!, oatHighF: v } })} />
              </Row>
              <Row label="SAT at low → high">
                <NumberField width="w-12" value={seq.dischargeAirReset.satAtLowF} onChange={(v) => patch({ dischargeAirReset: { ...seq.dischargeAirReset!, satAtLowF: v } })} />
                <NumberField width="w-12" value={seq.dischargeAirReset.satAtHighF} unit="°F" onChange={(v) => patch({ dischargeAirReset: { ...seq.dischargeAirReset!, satAtHighF: v } })} />
              </Row>
            </>
          )}
        </Section>
      )}

      {seq.economizer && (
        <Section
          title="Economizer / OA Reset"
          right={<Toggle checked={seq.economizer.enabled} onChange={(v) => patch({ economizer: { ...seq.economizer!, enabled: v } })} />}
        >
          <Row label="Type">
            <Select
              value={seq.economizer.type}
              options={[
                { value: 'fixed-min', label: 'Fixed Min OA' },
                { value: 'dry-bulb', label: 'Dry Bulb' },
                { value: 'enthalpy', label: 'Enthalpy' },
                { value: 'differential', label: 'Differential' },
              ]}
              onChange={(v) => patch({ economizer: { ...seq.economizer!, type: v } })}
            />
          </Row>
          <Row label="Min OA">
            <NumberField value={seq.economizer.minOaPct} unit="%" onChange={(v) => patch({ economizer: { ...seq.economizer!, minOaPct: v } })} />
          </Row>
          <Row label="High-limit OAT">
            <NumberField value={seq.economizer.highLimitOatF} unit="°F" onChange={(v) => patch({ economizer: { ...seq.economizer!, highLimitOatF: v } })} />
          </Row>
        </Section>
      )}

      {seq.staticPressureReset && (
        <Section
          title="Static Pressure Reset"
          right={<Toggle checked={seq.staticPressureReset.enabled} onChange={(v) => patch({ staticPressureReset: { ...seq.staticPressureReset!, enabled: v } })} />}
        >
          <Row label="Strategy">
            <Select
              value={seq.staticPressureReset.strategy}
              options={[
                { value: 'fixed', label: 'Fixed' },
                { value: 'trim-respond', label: 'Trim & Respond' },
              ]}
              onChange={(v) => patch({ staticPressureReset: { ...seq.staticPressureReset!, strategy: v } })}
            />
          </Row>
          <Row label="Setpoint">
            <NumberField step={0.05} value={seq.staticPressureReset.fixedSetpointInWc} unit="in wc" onChange={(v) => patch({ staticPressureReset: { ...seq.staticPressureReset!, fixedSetpointInWc: v } })} />
          </Row>
        </Section>
      )}

      {(['chwReset', 'hwReset', 'cwReset'] as const).map((key) => {
        const r = seq[key]
        if (!r) return null
        const title = key === 'chwReset' ? 'Chilled Water Reset' : key === 'hwReset' ? 'Hot Water Reset' : 'Condenser Water Reset'
        return (
          <Section key={key} title={title} right={<Toggle checked={r.enabled} onChange={(v) => patch({ [key]: { ...r, enabled: v } } as Partial<ControlSequences>)} />}>
            <Row label="Strategy">
              <Select
                value={r.strategy}
                options={[
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'oat', label: 'OAT-based' },
                  { value: 'load', label: 'Load-based' },
                ]}
                onChange={(v) => patch({ [key]: { ...r, strategy: v } } as Partial<ControlSequences>)}
              />
            </Row>
            {r.strategy === 'fixed' ? (
              <Row label="Setpoint">
                <NumberField value={r.fixedSetpointF} unit="°F" onChange={(v) => patch({ [key]: { ...r, fixedSetpointF: v } } as Partial<ControlSequences>)} />
              </Row>
            ) : (
              <>
                <Row label="Ref low → high">
                  <NumberField width="w-12" value={r.oatLowF} onChange={(v) => patch({ [key]: { ...r, oatLowF: v } } as Partial<ControlSequences>)} />
                  <NumberField width="w-12" value={r.oatHighF} onChange={(v) => patch({ [key]: { ...r, oatHighF: v } } as Partial<ControlSequences>)} />
                </Row>
                <Row label="Sup at low → high">
                  <NumberField width="w-12" value={r.satAtLowF} onChange={(v) => patch({ [key]: { ...r, satAtLowF: v } } as Partial<ControlSequences>)} />
                  <NumberField width="w-12" value={r.satAtHighF} unit="°F" onChange={(v) => patch({ [key]: { ...r, satAtHighF: v } } as Partial<ControlSequences>)} />
                </Row>
              </>
            )}
          </Section>
        )
      })}

      {seq.schedule && (
        <Section
          title="Occupancy Schedule"
          right={<Toggle checked={seq.schedule.enabled} onChange={(v) => patch({ schedule: { ...seq.schedule!, enabled: v } })} />}
        >
          <Row label="Weekday occ.">
            <NumberField width="w-12" value={seq.schedule.weekdayStartHr} onChange={(v) => patch({ schedule: { ...seq.schedule!, weekdayStartHr: v } })} />
            <NumberField width="w-12" value={seq.schedule.weekdayEndHr} unit="h" onChange={(v) => patch({ schedule: { ...seq.schedule!, weekdayEndHr: v } })} />
          </Row>
          <Row label="Override">
            <Select
              value={seq.schedule.override}
              options={[
                { value: 'none', label: 'None' },
                { value: 'force-occupied', label: 'Force Occupied' },
                { value: 'force-unoccupied', label: 'Force Unoccupied' },
              ]}
              onChange={(v) => patch({ schedule: { ...seq.schedule!, override: v } })}
            />
          </Row>
        </Section>
      )}

      {seq.dcv && (
        <Section
          title="Demand-Controlled Ventilation"
          right={<Toggle checked={seq.dcv.enabled} onChange={(v) => patch({ dcv: { ...seq.dcv!, enabled: v } })} />}
        >
          <Row label="CO₂ setpoint">
            <NumberField value={seq.dcv.co2SetpointPpm} unit="ppm" onChange={(v) => patch({ dcv: { ...seq.dcv!, co2SetpointPpm: v } })} />
          </Row>
          <Row label="Max OA">
            <NumberField value={seq.dcv.maxOaPct} unit="%" onChange={(v) => patch({ dcv: { ...seq.dcv!, maxOaPct: v } })} />
          </Row>
        </Section>
      )}

      {seq.staging && (
        <Section
          title="Staging & Rotation"
          right={<Toggle checked={seq.staging.enabled} onChange={(v) => patch({ staging: { ...seq.staging!, enabled: v } })} />}
        >
          <Row label="Lead/lag order">
            <NumberField width="w-12" value={seq.staging.order} onChange={(v) => patch({ staging: { ...seq.staging!, order: v } })} />
          </Row>
          <Row label="Stage up / down">
            <NumberField width="w-12" value={seq.staging.stageUpLoadPct} onChange={(v) => patch({ staging: { ...seq.staging!, stageUpLoadPct: v } })} />
            <NumberField width="w-12" value={seq.staging.stageDownLoadPct} unit="%" onChange={(v) => patch({ staging: { ...seq.staging!, stageDownLoadPct: v } })} />
          </Row>
          <Row label="Min off-time">
            <NumberField value={seq.staging.minOffTimeMin} unit="min" onChange={(v) => patch({ staging: { ...seq.staging!, minOffTimeMin: v } })} />
          </Row>
        </Section>
      )}

      {seq.optimalStart && (
        <Section
          title="Optimal Start/Stop"
          right={<Toggle checked={seq.optimalStart.enabled} onChange={(v) => patch({ optimalStart: { ...seq.optimalStart!, enabled: v } })} />}
        >
          <Row label="Warm-up rate">
            <NumberField step={0.5} value={seq.optimalStart.learnedWarmupRate} unit="°F/h" onChange={(v) => patch({ optimalStart: { ...seq.optimalStart!, learnedWarmupRate: v } })} />
          </Row>
          <Row label="Max lead time">
            <NumberField value={seq.optimalStart.maxLeadTimeMin} unit="min" onChange={(v) => patch({ optimalStart: { ...seq.optimalStart!, maxLeadTimeMin: v } })} />
          </Row>
        </Section>
      )}
    </div>
  )
}
