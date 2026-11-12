import type { ClimateZone } from "@/lib/types";

/**
 * Default ECBC climate zone by state/UT and a few city overrides.
 * APPROXIMATE — several states span more than one zone. The user can always
 * override the suggestion in the Check. Verify against the ECBC climate-zone map.
 */
export const climateZoneLabels: Record<ClimateZone, string> = {
  composite: "Composite",
  hot_dry: "Hot & Dry",
  warm_humid: "Warm & Humid",
  temperate: "Temperate",
  cold: "Cold",
};

export const stateZones: Record<string, ClimateZone> = {
  "Andaman and Nicobar Islands": "warm_humid",
  "Andhra Pradesh": "warm_humid",
  "Arunachal Pradesh": "cold",
  Assam: "warm_humid",
  Bihar: "composite",
  Chandigarh: "composite",
  Chhattisgarh: "composite",
  "Dadra and Nagar Haveli and Daman and Diu": "warm_humid",
  Delhi: "composite",
  Goa: "warm_humid",
  Gujarat: "hot_dry",
  Haryana: "composite",
  "Himachal Pradesh": "cold",
  "Jammu and Kashmir": "cold",
  Jharkhand: "composite",
  Karnataka: "warm_humid",
  Kerala: "warm_humid",
  Ladakh: "cold",
  Lakshadweep: "warm_humid",
  "Madhya Pradesh": "composite",
  Maharashtra: "warm_humid",
  Manipur: "warm_humid",
  Meghalaya: "warm_humid",
  Mizoram: "warm_humid",
  Nagaland: "warm_humid",
  Odisha: "warm_humid",
  Puducherry: "warm_humid",
  Punjab: "composite",
  Rajasthan: "hot_dry",
  Sikkim: "cold",
  "Tamil Nadu": "warm_humid",
  Telangana: "composite",
  Tripura: "warm_humid",
  "Uttar Pradesh": "composite",
  Uttarakhand: "composite",
  "West Bengal": "warm_humid",
};

export const states = Object.keys(stateZones).sort();

/** City overrides where the city differs from its state's default. Keys are lower-case. */
export const cityZones: Record<string, ClimateZone> = {
  bengaluru: "temperate",
  bangalore: "temperate",
  mysuru: "temperate",
  pune: "warm_humid",
  nagpur: "composite",
  aurangabad: "hot_dry",
  "chhatrapati sambhajinagar": "hot_dry",
  shimla: "cold",
  srinagar: "cold",
  leh: "cold",
  dehradun: "composite",
  darjeeling: "cold",
  shillong: "cold",
  jodhpur: "hot_dry",
  hyderabad: "composite",
};

export function suggestZone(state: string, city: string): ClimateZone {
  return cityZones[city.trim().toLowerCase()] ?? stateZones[state] ?? "composite";
}
