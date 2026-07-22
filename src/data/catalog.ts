// ---------------------------------------------------------------------------
// Curated catalog of real-world equipment model numbers with plausible
// nameplate defaults. Picking a model pre-fills the inspector; every value
// remains editable, and the generic "Other" block plus freeform text entry
// cover anything the list doesn't. Numbers are representative for training,
// not published performance data.
// ---------------------------------------------------------------------------

import type { CatalogModel } from '../types/domain'

export const CATALOG: CatalogModel[] = [
  // --- Chillers: air-cooled ------------------------------------------------
  {
    id: 'trane-rtac-140',
    manufacturer: 'Trane',
    model: 'RTAC 140',
    category: 'chiller',
    variant: 'air-cooled',
    nameplate: { tons: 140, kw: 168, eer: 10.0, iplv: 15.5, cop: 2.93, chwSupplyF: 44, chwDeltaT: 10, minTurndownPct: 25 },
  },
  {
    id: 'trane-rtac-200',
    manufacturer: 'Trane',
    model: 'RTAC 200',
    category: 'chiller',
    variant: 'air-cooled',
    nameplate: { tons: 200, kw: 232, eer: 10.3, iplv: 16.1, cop: 3.02, chwSupplyF: 44, chwDeltaT: 10, minTurndownPct: 20 },
  },
  {
    id: 'carrier-30xa-160',
    manufacturer: 'Carrier',
    model: '30XA 160',
    category: 'chiller',
    variant: 'air-cooled',
    nameplate: { tons: 160, kw: 182, eer: 10.5, iplv: 16.8, cop: 3.08, chwSupplyF: 44, chwDeltaT: 10, minTurndownPct: 20 },
  },
  {
    id: 'york-yvaa-180',
    manufacturer: 'York',
    model: 'YVAA 180',
    category: 'chiller',
    variant: 'air-cooled',
    nameplate: { tons: 180, kw: 194, eer: 11.1, iplv: 20.5, cop: 3.25, chwSupplyF: 44, chwDeltaT: 10, minTurndownPct: 12 },
  },
  {
    id: 'daikin-ags-130',
    manufacturer: 'Daikin',
    model: 'AGZ 130E',
    category: 'chiller',
    variant: 'air-cooled',
    nameplate: { tons: 130, kw: 158, eer: 9.9, iplv: 15.2, cop: 2.9, chwSupplyF: 44, chwDeltaT: 10, minTurndownPct: 25 },
  },
  // --- Chillers: water-cooled ---------------------------------------------
  {
    id: 'trane-cvhf-500',
    manufacturer: 'Trane',
    model: 'CenTraVac CVHF 500',
    category: 'chiller',
    variant: 'water-cooled',
    nameplate: { tons: 500, kw: 285, eer: 21.0, iplv: 32.0, cop: 6.16, chwSupplyF: 42, chwDeltaT: 12, minTurndownPct: 10 },
  },
  {
    id: 'carrier-19dv-450',
    manufacturer: 'Carrier',
    model: '19DV 450',
    category: 'chiller',
    variant: 'water-cooled',
    nameplate: { tons: 450, kw: 250, eer: 21.6, iplv: 34.0, cop: 6.33, chwSupplyF: 42, chwDeltaT: 12, minTurndownPct: 10 },
  },
  {
    id: 'york-ymc2-350',
    manufacturer: 'York',
    model: 'YMC² 350',
    category: 'chiller',
    variant: 'water-cooled',
    nameplate: { tons: 350, kw: 196, eer: 21.4, iplv: 33.5, cop: 6.28, chwSupplyF: 42, chwDeltaT: 12, minTurndownPct: 8 },
  },
  {
    id: 'daikin-wme-400',
    manufacturer: 'Daikin',
    model: 'WME-C 400',
    category: 'chiller',
    variant: 'water-cooled',
    nameplate: { tons: 400, kw: 232, eer: 20.7, iplv: 31.0, cop: 6.07, chwSupplyF: 42, chwDeltaT: 12, minTurndownPct: 10 },
  },

  // --- Boilers: condensing -------------------------------------------------
  {
    id: 'aerco-benchmark-3000',
    manufacturer: 'AERCO',
    model: 'Benchmark 3000',
    category: 'boiler',
    variant: 'condensing',
    nameplate: { mbh: 3000, effPct: 97, hwSupplyF: 140, hwDeltaT: 20, minTurndownPct: 5, parasiticKw: 2.2 },
  },
  {
    id: 'lochinvar-crest-2500',
    manufacturer: 'Lochinvar',
    model: 'CREST FBdec 2500',
    category: 'boiler',
    variant: 'condensing',
    nameplate: { mbh: 2500, effPct: 96, hwSupplyF: 140, hwDeltaT: 20, minTurndownPct: 4, parasiticKw: 1.8 },
  },
  {
    id: 'viessmann-vitocrossal-1500',
    manufacturer: 'Viessmann',
    model: 'Vitocrossal 200 CM2',
    category: 'boiler',
    variant: 'condensing',
    nameplate: { mbh: 1500, effPct: 95, hwSupplyF: 140, hwDeltaT: 20, minTurndownPct: 20, parasiticKw: 1.2 },
  },
  // --- Boilers: non-condensing --------------------------------------------
  {
    id: 'weil-mclain-lgb-2000',
    manufacturer: 'Weil-McLain',
    model: 'LGB-11',
    category: 'boiler',
    variant: 'non-condensing',
    nameplate: { mbh: 2000, effPct: 82, hwSupplyF: 180, hwDeltaT: 20, minTurndownPct: 100, parasiticKw: 1.0 },
  },
  {
    id: 'cleaver-brooks-cbex-1500',
    manufacturer: 'Cleaver-Brooks',
    model: 'CBEX Elite 1500',
    category: 'boiler',
    variant: 'non-condensing',
    nameplate: { mbh: 1500, effPct: 85, hwSupplyF: 180, hwDeltaT: 20, minTurndownPct: 25, parasiticKw: 1.4 },
  },

  // --- Air handling: AHU ---------------------------------------------------
  {
    id: 'trane-cscf-20',
    manufacturer: 'Trane',
    model: 'Climate Changer CSCF-20',
    category: 'ahu',
    nameplate: { cfm: 20000, minOaPct: 15, fanKw: 18, coolTons: 55, heatMbh: 400, satDesignF: 55, minStaticInWc: 0.6 },
  },
  {
    id: 'daikin-vision-30',
    manufacturer: 'Daikin',
    model: 'Vision 30',
    category: 'ahu',
    nameplate: { cfm: 30000, minOaPct: 15, fanKw: 28, coolTons: 82, heatMbh: 560, satDesignF: 55, minStaticInWc: 0.6 },
  },
  {
    id: 'carrier-39m-15',
    manufacturer: 'Carrier',
    model: '39M AERO 15',
    category: 'ahu',
    nameplate: { cfm: 15000, minOaPct: 20, fanKw: 13, coolTons: 42, heatMbh: 300, satDesignF: 55, minStaticInWc: 0.5 },
  },
  {
    id: 'york-solution-25',
    manufacturer: 'York',
    model: 'Solution XT 25',
    category: 'ahu',
    nameplate: { cfm: 25000, minOaPct: 15, fanKw: 23, coolTons: 68, heatMbh: 480, satDesignF: 55, minStaticInWc: 0.6 },
  },
  // --- Air handling: RTU ---------------------------------------------------
  {
    id: 'carrier-48tc-20',
    manufacturer: 'Carrier',
    model: 'WeatherMaster 48TC 20',
    category: 'rtu',
    nameplate: { cfm: 8000, minOaPct: 20, fanKw: 7.5, coolTons: 20, heatMbh: 250, satDesignF: 55, minStaticInWc: 0.5 },
  },
  {
    id: 'trane-precedent-15',
    manufacturer: 'Trane',
    model: 'Precedent 15-ton',
    category: 'rtu',
    nameplate: { cfm: 6000, minOaPct: 20, fanKw: 5.6, coolTons: 15, heatMbh: 180, satDesignF: 55, minStaticInWc: 0.5 },
  },
  {
    id: 'daikin-rebel-25',
    manufacturer: 'Daikin',
    model: 'Rebel DPS 25',
    category: 'rtu',
    variant: 'inverter',
    nameplate: { cfm: 10000, minOaPct: 20, fanKw: 8.2, coolTons: 25, heatMbh: 320, satDesignF: 55, minStaticInWc: 0.5 },
  },
  {
    id: 'aaon-rn-30',
    manufacturer: 'AAON',
    model: 'RN-030',
    category: 'rtu',
    nameplate: { cfm: 12000, minOaPct: 20, fanKw: 10, coolTons: 30, heatMbh: 400, satDesignF: 55, minStaticInWc: 0.6 },
  },
  // --- Air handling: FCU ---------------------------------------------------
  {
    id: 'ial-fcu-04',
    manufacturer: 'International Environmental',
    model: 'LWE-04',
    category: 'fcu',
    nameplate: { cfm: 400, fanKw: 0.25, coolTons: 1, heatMbh: 12 },
  },
  {
    id: 'daikin-fcu-08',
    manufacturer: 'Daikin',
    model: 'FCHC-08',
    category: 'fcu',
    nameplate: { cfm: 800, fanKw: 0.5, coolTons: 2, heatMbh: 24 },
  },
  // --- Air handling: WSHP --------------------------------------------------
  {
    id: 'climatemaster-tranquility-036',
    manufacturer: 'ClimateMaster',
    model: 'Tranquility 27 TT036',
    category: 'wshp',
    nameplate: { cfm: 1200, coolTons: 3, eer: 16.5, cop: 4.5, compKw: 2.2 },
  },
  {
    id: 'trane-gehc-048',
    manufacturer: 'Trane',
    model: 'GEH 048',
    category: 'wshp',
    nameplate: { cfm: 1600, coolTons: 4, eer: 14.2, cop: 4.1, compKw: 3.1 },
  },
  {
    id: 'waterfurnace-ndv-060',
    manufacturer: 'WaterFurnace',
    model: 'Envision2 NDV060',
    category: 'wshp',
    nameplate: { cfm: 2000, coolTons: 5, eer: 15.8, cop: 4.3, compKw: 3.6 },
  },

  // --- Heat exchangers -----------------------------------------------------
  {
    id: 'alfa-laval-m10',
    manufacturer: 'Alfa Laval',
    model: 'M10-BFG',
    category: 'hx',
    variant: 'plate-and-frame',
    nameplate: { mbh: 1500, approachF: 2, gpm: 150 },
  },
  {
    id: 'bell-gossett-gpx',
    manufacturer: 'Bell & Gossett',
    model: 'GPX Plate',
    category: 'hx',
    variant: 'plate-and-frame',
    nameplate: { mbh: 2000, approachF: 3, gpm: 200 },
  },
  {
    id: 'bell-gossett-su-shell',
    manufacturer: 'Bell & Gossett',
    model: 'SU Shell & Tube',
    category: 'hx',
    variant: 'shell-and-tube',
    nameplate: { mbh: 1200, approachF: 5, gpm: 120 },
  },

  // --- Pumps ---------------------------------------------------------------
  {
    id: 'bg-e1510-chw',
    manufacturer: 'Bell & Gossett',
    model: 'e-1510 5BC',
    category: 'pump',
    variant: 'CHW',
    nameplate: { gpm: 600, headFt: 70, hp: 20, effPct: 80 },
  },
  {
    id: 'grundfos-cr64-hw',
    manufacturer: 'Grundfos',
    model: 'CR 64',
    category: 'pump',
    variant: 'HW',
    nameplate: { gpm: 300, headFt: 90, hp: 15, effPct: 76 },
  },
  {
    id: 'armstrong-4380-cw',
    manufacturer: 'Armstrong',
    model: '4380 Vertical In-Line',
    category: 'pump',
    variant: 'condenser',
    nameplate: { gpm: 900, headFt: 55, hp: 25, effPct: 82 },
  },
  {
    id: 'tabco-4302-chw',
    manufacturer: 'Taco',
    model: 'FI 4013',
    category: 'pump',
    variant: 'CHW',
    nameplate: { gpm: 450, headFt: 60, hp: 10, effPct: 78 },
  },

  // --- Cooling towers ------------------------------------------------------
  {
    id: 'bac-vt1-250',
    manufacturer: 'BAC',
    model: 'Series V VT1-N250',
    category: 'coolingTower',
    nameplate: { tons: 250, gpm: 750, fanHp: 25, approachF: 5, rangeF: 10 },
  },
  {
    id: 'marley-nc-300',
    manufacturer: 'Marley',
    model: 'NC 8403',
    category: 'coolingTower',
    nameplate: { tons: 300, gpm: 900, fanHp: 30, approachF: 5, rangeF: 10 },
  },
  {
    id: 'evapco-at-200',
    manufacturer: 'EVAPCO',
    model: 'AT 19-212',
    category: 'coolingTower',
    nameplate: { tons: 200, gpm: 600, fanHp: 20, approachF: 6, rangeF: 10 },
  },

  // --- VAV boxes -----------------------------------------------------------
  {
    id: 'titus-dtqs-08-reheat',
    manufacturer: 'Titus',
    model: 'DESV 08 (reheat)',
    category: 'vav',
    variant: 'with reheat',
    nameplate: { maxCfm: 1200, minCfm: 360, reheatMbh: 24 },
  },
  {
    id: 'titus-dtqs-06-cooling',
    manufacturer: 'Titus',
    model: 'DESV 06 (cooling only)',
    category: 'vav',
    variant: 'cooling only',
    nameplate: { maxCfm: 800, minCfm: 240, reheatMbh: 0 },
  },
  {
    id: 'price-sdv-10-reheat',
    manufacturer: 'Price',
    model: 'SDV 10 (reheat)',
    category: 'vav',
    variant: 'with reheat',
    nameplate: { maxCfm: 1500, minCfm: 450, reheatMbh: 30 },
  },
  {
    id: 'nailor-3000-04',
    manufacturer: 'Nailor',
    model: '3000 Series 04',
    category: 'vav',
    variant: 'cooling only',
    nameplate: { maxCfm: 500, minCfm: 150, reheatMbh: 0 },
  },

  // --- Sensors -------------------------------------------------------------
  { id: 'sensor-temp', manufacturer: 'Generic', model: '10K Type-II Temp', category: 'sensor', variant: 'temp', nameplate: { driftF: 0 } },
  { id: 'sensor-pressure', manufacturer: 'Generic', model: 'Duct Static 0-5" WC', category: 'sensor', variant: 'pressure', nameplate: { driftF: 0 } },
  { id: 'sensor-flow', manufacturer: 'Onicon', model: 'F-1100 Flow', category: 'sensor', variant: 'flow', nameplate: { driftF: 0 } },
  { id: 'sensor-co2', manufacturer: 'Veris', model: 'CDD CO₂', category: 'sensor', variant: 'co2', nameplate: { driftF: 0 } },
  { id: 'sensor-occ', manufacturer: 'Wattstopper', model: 'DT-300 Occupancy', category: 'sensor', variant: 'occupancy', nameplate: { driftF: 0 } },

  // --- VFDs ----------------------------------------------------------------
  { id: 'abb-ach580-15', manufacturer: 'ABB', model: 'ACH580 15HP', category: 'vfd', nameplate: { hp: 15, minSpeedPct: 20 } },
  { id: 'danfoss-fc102-25', manufacturer: 'Danfoss', model: 'VLT FC-102 25HP', category: 'vfd', nameplate: { hp: 25, minSpeedPct: 20 } },
  { id: 'yaskawa-z1000-10', manufacturer: 'Yaskawa', model: 'Z1000 10HP', category: 'vfd', nameplate: { hp: 10, minSpeedPct: 15 } },
]

export function catalogFor(category: CatalogModel['category']): CatalogModel[] {
  return CATALOG.filter((m) => m.category === category)
}

export function catalogById(id: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.id === id)
}
