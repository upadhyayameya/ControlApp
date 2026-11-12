import { suggestZone } from "@/data/climate";
import { sampleHotelInput } from "@/data/sample";
import { lastTwelveMonths } from "@/lib/check/csv";
import type {
  AreaUnit,
  CheckInput,
  ClimateZone,
  FacilityType,
  ManufacturingSubType,
  MonthlyReading,
} from "@/lib/types";

/** Form state: numbers are kept as strings while the user types. */
export interface CheckDraft {
  facilityType: FacilityType | "";
  manufacturingSubType: ManufacturingSubType | "";
  floorArea: string;
  areaUnit: AreaUnit;
  annualProductionTonnes: string;
  rooms: string;
  state: string;
  city: string;
  climateZone: ClimateZone | "";
  zoneTouched: boolean;
  startMonth: string; // YYYY-MM
  kwh: string[];
  amount: string[];
  dieselLitres: string;
  lpgKg: string;
  pngScm: string;
  solarKwh: string;
  exportsToEU: "" | "yes" | "no";
  listed: "" | "yes" | "no";
  isSample: boolean;
}

export function emptyDraft(): CheckDraft {
  return {
    facilityType: "",
    manufacturingSubType: "",
    floorArea: "",
    areaUnit: "m2",
    annualProductionTonnes: "",
    rooms: "",
    state: "",
    city: "",
    climateZone: "",
    zoneTouched: false,
    startMonth: lastTwelveMonths()[0],
    kwh: Array(12).fill(""),
    amount: Array(12).fill(""),
    dieselLitres: "",
    lpgKg: "",
    pngScm: "",
    solarKwh: "",
    exportsToEU: "",
    listed: "",
    isSample: false,
  };
}

export function monthsFrom(start: string): string[] {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const num = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function isNumberish(s: string, { required = false, min = 0, positive = false } = {}): boolean {
  const t = s.replace(/,/g, "").trim();
  if (!t) return !required;
  const n = Number(t);
  return Number.isFinite(n) && n >= min && (!positive || n > 0);
}

/** Returns field → message for the given step (empty = valid). */
export function validateStep(d: CheckDraft, step: number): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!d.facilityType) e.facilityType = "Choose a facility type.";
    if (d.facilityType === "manufacturing") {
      if (!d.manufacturingSubType) e.manufacturingSubType = "Choose a sub-sector.";
      if (!isNumberish(d.annualProductionTonnes, { required: true, positive: true }))
        e.annualProductionTonnes = "Enter annual production in tonnes.";
    } else if (d.facilityType) {
      if (!isNumberish(d.floorArea, { required: true, positive: true })) e.floorArea = "Enter the built-up floor area.";
    }
    if (d.facilityType === "hotel" && !isNumberish(d.rooms, { required: true, positive: true }))
      e.rooms = "Enter the number of rooms (keys).";
  }
  if (step === 1) {
    if (!d.state) e.state = "Choose a state or UT.";
    if (!d.city.trim()) e.city = "Enter a city.";
    if (!d.climateZone) e.climateZone = "Choose a climate zone.";
  }
  if (step === 2) {
    d.kwh.forEach((v, i) => {
      if (!isNumberish(v, { required: true })) e[`kwh-${i}`] = "Enter kWh (0 or more).";
    });
    d.amount.forEach((v, i) => {
      if (!isNumberish(v)) e[`amount-${i}`] = "Enter a number or leave blank.";
    });
  }
  if (step === 3) {
    for (const k of ["dieselLitres", "lpgKg", "pngScm", "solarKwh"] as const) {
      if (!isNumberish(d[k])) e[k] = "Enter a number or leave blank.";
    }
    if (!d.exportsToEU) e.exportsToEU = "Please answer.";
    if (!d.listed) e.listed = "Please answer.";
  }
  return e;
}

export function draftToInput(d: CheckDraft): CheckInput {
  const months: MonthlyReading[] = monthsFrom(d.startMonth).map((month, i) => ({
    month,
    kwh: num(d.kwh[i]) ?? 0,
    amountInr: num(d.amount[i]),
  }));
  const isPlant = d.facilityType === "manufacturing";
  return {
    facilityType: d.facilityType as FacilityType,
    manufacturingSubType: isPlant ? (d.manufacturingSubType as ManufacturingSubType) : null,
    floorArea: isPlant ? null : num(d.floorArea),
    areaUnit: d.areaUnit,
    annualProductionTonnes: isPlant ? num(d.annualProductionTonnes) : null,
    city: d.city.trim(),
    state: d.state,
    climateZone: (d.climateZone || suggestZone(d.state, d.city)) as ClimateZone,
    rooms: d.facilityType === "hotel" ? num(d.rooms) : null,
    months,
    dieselLitres: num(d.dieselLitres),
    lpgKg: num(d.lpgKg),
    pngScm: num(d.pngScm),
    solarKwh: num(d.solarKwh),
    exportsToEU: d.exportsToEU === "yes",
    listedOrSupplierToListed: d.listed === "yes",
  };
}

export function sampleDraft(readings: MonthlyReading[]): CheckDraft {
  const s = sampleHotelInput;
  const str = (n: number | null) => (n === null ? "" : String(n));
  return {
    ...emptyDraft(),
    facilityType: s.facilityType,
    floorArea: str(s.floorArea),
    areaUnit: s.areaUnit,
    rooms: str(s.rooms),
    state: s.state,
    city: s.city,
    climateZone: s.climateZone,
    zoneTouched: true,
    startMonth: readings[0].month,
    kwh: readings.map((r) => String(r.kwh)),
    amount: readings.map((r) => str(r.amountInr)),
    dieselLitres: str(s.dieselLitres),
    lpgKg: str(s.lpgKg),
    pngScm: str(s.pngScm),
    solarKwh: str(s.solarKwh),
    exportsToEU: s.exportsToEU ? "yes" : "no",
    listed: s.listedOrSupplierToListed ? "yes" : "no",
    isSample: true,
  };
}

export const facilityOptions: { value: FacilityType; label: string }[] = [
  { value: "hotel", label: "Hotel" },
  { value: "office", label: "Office" },
  { value: "hospital", label: "Hospital" },
  { value: "retail", label: "Mall / Retail" },
  { value: "manufacturing", label: "Manufacturing" },
];

export const subTypeOptions: { value: ManufacturingSubType; label: string }[] = [
  { value: "steel", label: "Steel" },
  { value: "aluminium", label: "Aluminium" },
  { value: "cement", label: "Cement" },
  { value: "textiles", label: "Textiles" },
  { value: "auto_components", label: "Auto components" },
  { value: "other", label: "Other" },
];

export const facilityLabel = (t: FacilityType) => facilityOptions.find((f) => f.value === t)?.label ?? t;
export const subTypeLabel = (t: ManufacturingSubType | null) =>
  t ? (subTypeOptions.find((f) => f.value === t)?.label ?? t) : "";
