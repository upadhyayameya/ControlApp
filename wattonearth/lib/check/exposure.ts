import { trackerHref } from "@/lib/regulations";
import type { CheckInput, RegulatoryExposure } from "@/lib/types";

/**
 * Screening rules for regulatory relevance. Deliberately cautious wording:
 * these flag what to check, they do not determine legal applicability.
 * Every card links to the tracker, which links to the official source.
 */
export function assessExposure(input: CheckInput): RegulatoryExposure[] {
  const isPlant = input.facilityType === "manufacturing";
  const sub = input.manufacturingSubType;
  const energyIntensive = isPlant && (sub === "steel" || sub === "aluminium" || sub === "cement" || sub === "textiles");
  const cbamGoods = isPlant && (sub === "steel" || sub === "aluminium" || sub === "cement");

  const ccts: RegulatoryExposure = energyIntensive
    ? {
        regime: "CCTS",
        level: "high",
        headline: "Likely relevant — energy-intensive sector",
        detail:
          "Your sector is among those targeted by India's carbon market. If your plant is a designated consumer, it may receive an emission-intensity target. Check the notified sectors and thresholds.",
        trackerHref: trackerHref("CCTS"),
      }
    : isPlant
      ? {
          regime: "CCTS",
          level: "medium",
          headline: "Possibly relevant — check thresholds",
          detail:
            "Obligations depend on notified sectors and consumption thresholds. Even if not obligated, the offset mechanism may let you earn credits from verified reductions.",
          trackerHref: trackerHref("CCTS"),
        }
      : {
          regime: "CCTS",
          level: "low",
          headline: "Unlikely to be obligated",
          detail:
            "Commercial buildings are not the focus of the compliance mechanism, but verified reductions may be eligible under the offset mechanism.",
          trackerHref: trackerHref("CCTS"),
        };

  const cbam: RegulatoryExposure = !input.exportsToEU
    ? {
        regime: "CBAM",
        level: "not_applicable",
        headline: "Not applicable — no EU exports",
        detail: "CBAM applies to goods imported into the EU. Revisit this if you start exporting to EU customers.",
        trackerHref: trackerHref("CBAM"),
      }
    : cbamGoods
      ? {
          regime: "CBAM",
          level: "high",
          headline: "Highly relevant — CBAM goods to the EU",
          detail:
            "Your EU importers need embedded-emissions data for your products. Actual plant data usually beats default values — start collecting it now.",
          trackerHref: trackerHref("CBAM"),
        }
      : sub === "auto_components"
        ? {
            regime: "CBAM",
            level: "medium",
            headline: "Check your CN codes",
            detail:
              "Some downstream iron & steel articles (for example certain fasteners) are CBAM goods. Check whether your products' CN codes are covered.",
            trackerHref: trackerHref("CBAM"),
          }
        : {
            regime: "CBAM",
            level: "low",
            headline: "Probably not covered — verify CN codes",
            detail: "Your products are not in the core CBAM sectors, but confirm the CN codes of what you export.",
            trackerHref: trackerHref("CBAM"),
          };

  const brsr: RegulatoryExposure = input.listedOrSupplierToListed
    ? {
        regime: "BRSR",
        level: "high",
        headline: "Relevant — listed company or value-chain partner",
        detail:
          "Listed companies report energy and emissions under BRSR, and the largest are extending BRSR Core to their value chain. Expect data requests for energy, Scope 1 and Scope 2.",
        trackerHref: trackerHref("BRSR"),
      }
    : {
        regime: "BRSR",
        level: "low",
        headline: "Not directly relevant today",
        detail: "If you become a supplier to a listed company, you may be asked for energy and emissions data.",
        trackerHref: trackerHref("BRSR"),
      };

  const ecbc: RegulatoryExposure = !isPlant
    ? {
        regime: "ECBC",
        level: "medium",
        headline: "Relevant for new builds and major retrofits",
        detail:
          "Commercial buildings above the connected-load threshold must comply where the state has notified the code. Existing buildings are affected mainly at expansion or major renovation.",
        trackerHref: trackerHref("ECBC"),
      }
    : {
        regime: "ECBC",
        level: "low",
        headline: "Limited relevance for process buildings",
        detail: "The code targets commercial buildings; your office or amenity blocks may be in scope in adopting states.",
        trackerHref: trackerHref("ECBC"),
      };

  return [ccts, cbam, brsr, ecbc];
}
