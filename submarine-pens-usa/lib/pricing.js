// US price from the India M.R.P. Same formula as the Range & Pricing Planner spreadsheet.
//
//   unit cost   = M.R.P. x pack x export cost % / exchange rate
//   landed      = unit cost x (1 + duty % + clearance %) + (duty per unit + freight) x pack
//   cost to sell = landed + fulfilment + card fixed fee
//   cost-based  = cost to sell / (1 - target margin - card fee %)
//   floor       = M.R.P. x pack / exchange rate x minimum multiple
//   price       = max(cost-based, floor) rounded up to the next .99

export function suggestedPriceCents(inrMrp, packSize, p) {
  const mrp = Number(inrMrp);
  const pack = Math.max(1, Number(packSize) || 1);
  if (!Number.isFinite(mrp) || mrp <= 0) return null;
  const fx = Number(p.inr_per_usd);
  const unitCost = (mrp * pack * Number(p.export_cost_pct_of_mrp)) / fx;
  const landed =
    unitCost * (1 + Number(p.duty_pct) + Number(p.clearance_pct)) +
    (Number(p.duty_per_unit_usd) + Number(p.freight_per_unit_usd)) * pack;
  const costToSell = landed + Number(p.fulfilment_per_unit_usd) + Number(p.card_fee_per_unit_usd);
  const costBased = costToSell / (1 - Number(p.target_margin) - Number(p.card_fee_pct));
  const floor = ((mrp * pack) / fx) * Number(p.min_multiple_of_india_price);
  const dollars = Math.ceil(Math.max(costBased, floor) - 1e-9) - 0.01;
  return Math.round(dollars * 100);
}
