import type { CheckInput } from "@/lib/types";

/**
 * SAMPLE — ILLUSTRATIVE ONLY. A fictional 180-key hotel in Mumbai used to
 * demonstrate the Check. Monthly data mirrors public/templates/sample-mumbai-hotel.csv.
 */
export const SAMPLE_LABEL = "Sample report — illustrative only";
export const SAMPLE_CSV_PATH = "/templates/sample-mumbai-hotel.csv";
export const TEMPLATE_CSV_PATH = "/templates/energy-check-template.csv";

export const sampleHotelInput: Omit<CheckInput, "months"> = {
  facilityType: "hotel",
  manufacturingSubType: null,
  floorArea: 16000,
  areaUnit: "m2",
  annualProductionTonnes: null,
  city: "Mumbai",
  state: "Maharashtra",
  climateZone: "warm_humid",
  rooms: 180,
  dieselLitres: 18000,
  lpgKg: 24000,
  pngScm: null,
  solarKwh: 60000,
  exportsToEU: false,
  listedOrSupplierToListed: true,
};
