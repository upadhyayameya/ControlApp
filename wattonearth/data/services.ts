import type { Service } from "@/lib/types";

/**
 * Service catalogue. `priceLabel: null` renders as "Fixed fee, confirmed before
 * we start" — set real prices here when ready (listed in README → Placeholders).
 */
export const services: Service[] = [
  {
    slug: "remote-energy-audit",
    name: "Remote Energy Audit",
    shortName: "Remote Energy Audit",
    pillar: "measure",
    tagline:
      "A fixed-price, data-led audit of your facility — delivered remotely from your bills, meter data and BMS trends, with a short site walk-through by video.",
    whoFor: [
      "Hotels, offices, hospitals and malls with 12+ months of electricity bills",
      "Plants that want a fast view of where energy is going before a capex decision",
      "Owners and facility managers who need an independent second opinion on vendor proposals",
    ],
    deliverables: [
      "Energy baseline and Energy Performance Index (EPI) or specific energy consumption, benchmarked",
      "End-use breakdown (HVAC, lighting, plug loads, process, utilities) from data and walk-through",
      "Ranked list of energy conservation measures with savings, cost and simple payback in ₹",
      "Tariff and contract-demand review, including power factor and time-of-day opportunities",
      "Scope 1 and Scope 2 emissions baseline aligned with the GHG Protocol",
      "A 60-minute walkthrough of findings with your team",
    ],
    howItWorks: [
      "Share 12–24 months of bills, meter or BMS exports and basic facility details",
      "We analyse the data and run a guided video walk-through with your engineer",
      "You receive the report within an agreed timeline, followed by a findings call",
    ],
    priceLabel: null,
    pricingModel: "fixed",
    relatedRegimes: ["ECBC", "BRSR"],
  },
  {
    slug: "monitoring-verification",
    name: "Monitoring & Verification Subscription",
    shortName: "Monitoring & Verification",
    pillar: "verify",
    tagline:
      "Monthly tracking of energy, cost and emissions against your baseline — so savings are proven, not promised, and drift is caught early.",
    whoFor: [
      "Facilities that have implemented efficiency measures and need to prove the savings",
      "Portfolios (hotel chains, office parks) that want one consistent view across sites",
      "Companies preparing emissions data for BRSR or buyer questionnaires every year",
    ],
    deliverables: [
      "Weather- and occupancy-normalised baseline model using IPMVP-style methods",
      "Monthly dashboard and short commentary: energy, ₹, tCO₂e, and variance from baseline",
      "Alerts for abnormal consumption, demand spikes and billing anomalies",
      "Quarterly review call and an annual savings and emissions statement",
    ],
    howItWorks: [
      "We build a baseline from historical data and agree the adjustment method with you",
      "Each month you (or your BMS) send data; we analyse and report",
      "Every quarter we review performance and re-prioritise actions",
    ],
    priceLabel: null,
    pricingModel: "subscription",
    relatedRegimes: ["BRSR", "CCTS"],
  },
  {
    slug: "cbam-emissions-data-pack",
    name: "CBAM Emissions Data Pack",
    shortName: "CBAM Data Pack",
    pillar: "measure",
    tagline:
      "Installation-level embedded-emissions data for exporters of CBAM goods, prepared in the structure your EU importer needs.",
    whoFor: [
      "Exporters of iron & steel, aluminium, cement and other CBAM goods to the EU",
      "Suppliers whose EU customers are asking for embedded-emissions data",
      "Plants that want to understand how their carbon intensity compares before buyers do",
    ],
    deliverables: [
      "Installation boundary, production processes and CN codes mapped",
      "Direct and indirect embedded emissions calculated per tonne of product",
      "Data prepared for the importer's communication template, with a clear audit trail",
      "Gap list: what to meter or record to replace default values with actual data",
    ],
    howItWorks: [
      "Scoping call to confirm products, CN codes and installation boundary",
      "Data collection from production, fuel, electricity and precursor records",
      "Calculation, review with your team and hand-over of the data pack",
    ],
    priceLabel: null,
    pricingModel: "project",
    relatedRegimes: ["CBAM"],
  },
  {
    slug: "brsr-value-chain",
    name: "BRSR Value-Chain Support",
    shortName: "BRSR Value-Chain",
    pillar: "verify",
    tagline:
      "Energy and emissions data your listed customers can use — for suppliers asked to support BRSR Core value-chain disclosures.",
    whoFor: [
      "MSME and mid-size suppliers to listed companies",
      "Listed companies organising energy and emissions data collection from their value chain",
      "Hotels and commercial buildings that are tenants or vendors of listed groups",
    ],
    deliverables: [
      "Energy consumption and Scope 1 & 2 emissions compiled with sources documented",
      "Intensity metrics (per ₹ turnover, per tonne, per m²) in the format your customer requests",
      "A short data-quality note that makes third-party assurance easier",
      "A reduction roadmap you can share with customers",
    ],
    howItWorks: [
      "Collect the customer's questionnaire and your utility and fuel records",
      "Compile, calculate and review the numbers with you",
      "Deliver the filled questionnaire and supporting workbook",
    ],
    priceLabel: null,
    pricingModel: "project",
    relatedRegimes: ["BRSR"],
  },
  {
    slug: "ccts-readiness",
    name: "CCTS Readiness",
    shortName: "CCTS Readiness",
    pillar: "reduce",
    tagline:
      "Prepare for India's Carbon Credit Trading Scheme: understand your likely obligation, your emissions intensity and the most cost-effective path to meet targets.",
    whoFor: [
      "Plants in energy-intensive sectors that may be notified as obligated entities",
      "Facilities that want to generate credits through the offset mechanism",
      "Management teams that need a clear briefing on exposure and timelines",
    ],
    deliverables: [
      "Applicability screening against the latest notified sectors and thresholds",
      "Baseline GHG emissions intensity (tCO₂e per tonne of product) with a data trail",
      "Target-gap analysis and a ranked abatement plan with ₹/tCO₂e",
      "Monitoring, reporting and verification (MRV) readiness checklist",
    ],
    howItWorks: [
      "Screen applicability using the official notifications linked in our tracker",
      "Build the emissions-intensity baseline from plant records",
      "Model abatement options and agree an implementation plan",
    ],
    priceLabel: null,
    pricingModel: "project",
    relatedRegimes: ["CCTS"],
  },
];

export const pillars = [
  {
    key: "measure" as const,
    title: "Measure",
    body: "Turn bills, meter data and BMS trends into a clear baseline of energy, cost and emissions — benchmarked against similar Indian facilities.",
  },
  {
    key: "reduce" as const,
    title: "Reduce",
    body: "Find the measures that pay back: HVAC and chiller optimisation, controls, tariff and demand management, process efficiency and on-site solar.",
  },
  {
    key: "verify" as const,
    title: "Verify",
    body: "Prove savings against a normalised baseline and produce emissions data that holds up for BRSR, CBAM buyers and CCTS reporting.",
  },
];

export function getService(slug: string): Service | undefined {
  return services.find((s) => s.slug === slug);
}
