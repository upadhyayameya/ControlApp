import type { FacilityType, ManufacturingSubType } from "@/lib/types";

export interface Measure {
  title: string;
  detail: string;
}

/** Typical efficiency measures by facility type (screening-level, not site-specific). */
export const buildingMeasures: Record<Exclude<FacilityType, "manufacturing">, Measure[]> = {
  hotel: [
    { title: "Chiller plant optimisation", detail: "Reset chilled-water temperature with load, sequence chillers by efficiency and fix low ΔT — usually the single largest saving in Indian hotels." },
    { title: "Guest-room energy management", detail: "Key-card or occupancy-linked control of FCUs and lighting, with setback in unsold rooms." },
    { title: "Heat recovery for hot water", detail: "Recover chiller condenser heat or use heat pumps for domestic hot water to cut diesel/LPG boiler use." },
    { title: "Kitchen and laundry ventilation control", detail: "Demand-controlled kitchen exhaust and scheduled laundry equipment to trim fan and thermal loads." },
    { title: "BMS schedule and setpoint review", detail: "Align AHU schedules with occupancy in banquets, restaurants and back-of-house areas." },
  ],
  office: [
    { title: "HVAC scheduling and setpoints", detail: "Align AHU/FCU schedules with actual occupancy and move cooling setpoints to 24–25 °C where comfort allows." },
    { title: "Chiller and cooling-tower optimisation", detail: "Condenser-water reset, VFDs on pumps and towers, and staging chillers for best kW/TR." },
    { title: "LED retrofit with daylight and occupancy controls", detail: "Replace remaining fluorescent fittings and add sensors in meeting rooms and perimeter zones." },
    { title: "After-hours base-load reduction", detail: "Identify and switch off plug loads, server-room overcooling and lifts left on overnight." },
    { title: "Tariff and contract-demand optimisation", detail: "Right-size contract demand, correct power factor and shift loads to off-peak time-of-day slots." },
  ],
  hospital: [
    { title: "Chiller plant optimisation", detail: "Efficient staging, chilled-water reset in non-critical zones and VFDs on secondary pumps." },
    { title: "Air-change rate review in non-critical areas", detail: "Match ventilation to guidelines by space type while protecting OTs, ICUs and isolation rooms." },
    { title: "Heat-pump hot water and steam trap survey", detail: "Replace diesel/LPG-fired hot water where feasible and fix failed steam traps." },
    { title: "Lighting retrofit and controls", detail: "LED fittings with occupancy control in corridors, stores and administrative areas." },
    { title: "Monitoring of critical plant", detail: "Sub-metering of chillers, AHUs and medical equipment to catch drift early." },
  ],
  retail: [
    { title: "Common-area HVAC optimisation", detail: "Supply-air temperature reset, CO₂-based fresh-air control and chiller sequencing." },
    { title: "Opening-hours scheduling", detail: "Tighten pre-cooling start and post-closing shutdown for AHUs, escalators and lighting." },
    { title: "Façade and signage lighting control", detail: "Astronomical timers and dimming for façade, signage and parking lighting." },
    { title: "Tenant sub-metering and recharge", detail: "Accurate tenant metering changes behaviour and reveals common-area waste." },
    { title: "Rooftop solar and demand management", detail: "On-site solar on roof and parking with peak-demand limiting." },
  ],
};

const commonPlant: Measure[] = [
  { title: "Compressed-air leak survey and pressure reduction", detail: "Leaks of 20–30% are common; fixing them and lowering header pressure saves compressor energy directly." },
  { title: "VFDs on pumps, fans and blowers", detail: "Replace throttling and dampers with speed control on variable-flow duties." },
  { title: "IE3/IE4 motors on high-duty drives", detail: "Replace rewound or oversized motors on continuous-duty applications." },
  { title: "Power-factor and harmonic correction", detail: "Avoid PF penalties and reduce losses in transformers and cables." },
];

export const plantMeasures: Record<ManufacturingSubType, Measure[]> = {
  steel: [
    { title: "Furnace and ladle insulation and heat recovery", detail: "Reduce shell losses and recover waste heat for pre-heating scrap or combustion air." },
    { title: "Induction/EAF power-on-time optimisation", detail: "Charge-mix, scrap preparation and tap-to-tap scheduling to cut kWh per tonne." },
    ...commonPlant.slice(0, 3),
  ],
  aluminium: [
    { title: "Cell voltage and anode-effect management", detail: "Tighter process control reduces kWh per tonne in smelting." },
    { title: "Extrusion press and billet heater optimisation", detail: "Heat billets to target temperature only and reduce idle running." },
    ...commonPlant.slice(0, 3),
  ],
  cement: [
    { title: "Grinding circuit optimisation", detail: "High-efficiency separators, mill internals and VRM operation to cut kWh per tonne." },
    { title: "Waste-heat recovery power", detail: "Generate electricity from pre-heater and cooler exhaust." },
    ...commonPlant.slice(1, 4),
  ],
  textiles: [
    { title: "Humidification plant optimisation", detail: "VFDs and controls on humidification fans and pumps in spinning and weaving." },
    { title: "Boiler and thermic-fluid heater efficiency", detail: "Combustion tuning, condensate recovery and insulation in processing houses." },
    ...commonPlant.slice(0, 3),
  ],
  auto_components: [
    { title: "Heat-treatment furnace optimisation", detail: "Insulation, loading density and burner tuning on heat-treatment lines." },
    { title: "Machine-tool idle-power reduction", detail: "Auto-standby of CNCs, coolant pumps and hydraulics during breaks." },
    ...commonPlant.slice(0, 3),
  ],
  other: [
    ...commonPlant,
    { title: "Process heat recovery", detail: "Recover heat from exhausts, condensate and cooling water for pre-heating." },
  ],
};

export function measuresFor(facilityType: FacilityType, subType: ManufacturingSubType | null): Measure[] {
  return facilityType === "manufacturing" ? plantMeasures[subType ?? "other"] : buildingMeasures[facilityType];
}
