"""Evaluate the workbook's formula graph with known inputs and check the numbers.

LibreOffice cannot start in this sandbox, so recalc.py is unavailable. This
loads a scaled-down copy of the same generated workbook, writes a small known
dataset into it, evaluates every formula with `formulas`, and asserts the
results against hand-computed expectations.
"""
import openpyxl, warnings, sys
warnings.filterwarnings("ignore")

SRC = "/tmp/penshow-verify/small.xlsx"
TST = "/tmp/penshow-verify/small_filled.xlsx"

wb = openpyxl.load_workbook(SRC)
sh, iv, sl = wb["Shows"], wb["Inventory"], wb["Sales Log"]

# ---------------------------------------------------------------- fixtures
# Show 1: SF, tax 9.375%, card 2.6% + $0.10, table 450 + travel 380 = 830
sh["I4"], sh["J4"] = 450, 380

# Inventory row 4 is the shipped example row: Submarine Shikari, cost 6, price 18,
# floor 14, qty 10. Row 5 is a second pen added here.
# Columns: A sku B brand C type D model E colour F nib G cost H mrp I price
#          J floor K dealer L qty-brought M sold N left O margin P margin@floor
#          Q profit R cost-tied S retail
iv["A5"], iv["B5"], iv["C5"], iv["D5"] = "LAM-BP-AVENTA-CHR", "Lamborghini", "Ballpoint", "Aventador"
iv["G5"], iv["I5"], iv["J5"], iv["L5"] = 18, 45, 36, 6

SHOW = "SF Pen Show"
# Sales: 1 Sailor @340 cash, 1 ink @25 cash, 2 Sailor @300 (discount 40 on line) card
rows = [
    ("2026-08-21", SHOW, "SUB-FP-SHIKAR-M-BLK", 1, 18, 0, "Yes", "Cash"),
    ("2026-08-21", SHOW, "LAM-BP-AVENTA-CHR",   2, 45, 0, "Yes", "Cash"),
    ("2026-08-22", SHOW, "SUB-FP-SHIKAR-M-BLK", 1, 18, 4, "Yes", "Card"),
]
for i, (d, show, sku, qty, price, disc, taxable, pay) in enumerate(rows):
    r = 4 + i
    sl[f"A{r}"], sl[f"B{r}"], sl[f"C{r}"] = d, show, sku
    sl[f"E{r}"], sl[f"F{r}"], sl[f"G{r}"] = qty, price, disc
    sl[f"I{r}"], sl[f"N{r}"] = taxable, pay

wb.save(TST)

# ------------------------------------------------------------------ solve
import formulas
xl = formulas.ExcelModel().loads(TST).finish()
sol = xl.calculate()

def cell(sheet, ref):
    key = f"'[small_filled.xlsx]{sheet.upper()}'!{ref}"
    v = sol[key]
    try:    v = v.value[0, 0]
    except Exception: pass
    try:    return float(v)
    except Exception: return v

fails = []
def check(label, got, want, tol=0.02):
    if isinstance(want, str):
        ok = str(got).strip() == want
    else:
        ok = isinstance(got, float) and abs(got - want) <= tol
    print(("  ok   " if ok else "  FAIL ") + f"{label}: got {got!r}, want {want}")
    if not ok: fails.append(label)

print("--- Shows ---")
check("total show cost (I:N sum)", cell("Shows", "O4"), 830)

print("--- Sales Log line maths ---")
# row 4: 1 Shikari @18, cost 6
check("r4 line revenue",  cell("Sales Log", "J4"), 18)
check("r4 unit cost lookup", cell("Sales Log", "H4"), 6)
check("r4 sales tax @9.375%", cell("Sales Log", "K4"), 1.69)
check("r4 COGS", cell("Sales Log", "L4"), 6)
check("r4 card fee (cash -> 0)", cell("Sales Log", "P4"), 0)
check("r4 profit", cell("Sales Log", "M4"), 12)
check("r4 net to you", cell("Sales Log", "Q4"), 19.69)
check("r4 item name from Brand + Model", cell("Sales Log", "D4"), "Submarine Shikari")
# row 5: 2 Aventador @45, cost 18
check("r5 line revenue", cell("Sales Log", "J5"), 90)
check("r5 unit cost lookup", cell("Sales Log", "H5"), 18)
check("r5 COGS", cell("Sales Log", "L5"), 36)
check("r5 tax", cell("Sales Log", "K5"), 8.44)
# row 6: 1 Shikari @18 less 4 discount, paid by card
check("r6 revenue net of discount", cell("Sales Log", "J6"), 14)
check("r6 tax on discounted base", cell("Sales Log", "K6"), 1.31)
check("r6 card fee 2.6% + 0.10", cell("Sales Log", "P6"), round((14 + 1.31) * 0.026 + 0.10, 2))
check("r6 profit after card fee", cell("Sales Log", "M6"), round(14 - 6 - (round((14 + 1.31) * 0.026 + 0.10, 2)), 2))

print("--- Inventory rollups ---")
check("Shikari qty sold (SUMIFS)", cell("Inventory", "M4"), 2)
check("Shikari qty left", cell("Inventory", "N4"), 8)
check("Shikari margin @ price", cell("Inventory", "O4"), (18 - 6) / 18)
check("Shikari margin @ floor", cell("Inventory", "P4"), (14 - 6) / 14)
check("Shikari profit per unit", cell("Inventory", "Q4"), 12)
check("Shikari cost tied up", cell("Inventory", "R4"), 8 * 6)
check("Shikari retail value", cell("Inventory", "S4"), 8 * 18)
check("Aventador qty sold", cell("Inventory", "M5"), 2)
check("Aventador qty left", cell("Inventory", "N5"), 4)

print("--- Dashboard P&L ---")
rev, cogs = 18 + 90 + 14, 6 + 36 + 6
fee = round((14 + 1.31) * 0.026 + 0.10, 2)
check("units", cell("Dashboard", "C4"), 4)
check("revenue", cell("Dashboard", "D4"), rev)
check("COGS", cell("Dashboard", "E4"), cogs)
check("gross profit", cell("Dashboard", "F4"), rev - cogs)
check("margin %", cell("Dashboard", "G4"), (rev - cogs) / rev)
check("card fees", cell("Dashboard", "H4"), fee)
check("show costs pulled from Shows", cell("Dashboard", "I4"), 830)
check("NET PROFIT", cell("Dashboard", "J4"), rev - cogs - fee - 830)
check("break-even revenue", cell("Dashboard", "K4"), (830 + fee) / ((rev - cogs) / rev))
check("sales tax collected", cell("Dashboard", "L4"), 1.69 + 8.44 + 1.31)
check("cash reconciliation", cell("Dashboard", "M4"), 19.69 + 98.44)
check("card reconciliation", cell("Dashboard", "P4"), round(14 + 1.31 - fee, 2))

# SHOW_ROWS=2 in the small build, so the SEASON TOTAL row is row 6
print("--- Season total row ---")
check("total units", cell("Dashboard", "C6"), 4)
check("total revenue", cell("Dashboard", "D6"), rev)
check("total net profit", cell("Dashboard", "J6"), rev - cogs - fee - 830)
check("total margin recomputed, not summed", cell("Dashboard", "G6"), (rev - cogs) / rev)

print("--- Inventory position block ---")
# block starts at row tr+3 = 9, labels in A, values in B
check("SKUs listed", cell("Dashboard", "B10"), 2)
check("units brought", cell("Dashboard", "B11"), 16)     # 10 Shikari + 6 Aventador
check("units sold", cell("Dashboard", "B12"), 4)
check("units left", cell("Dashboard", "B13"), 12)
check("cost still on table", cell("Dashboard", "B14"), 8 * 6 + 4 * 18)
check("retail still on table", cell("Dashboard", "B15"), 8 * 18 + 4 * 45)
check("sell-through", cell("Dashboard", "B16"), 4 / 16)

print("\n=== formula failures: %d ===" % len(fails))
for f in fails: print(" -", f)
sys.exit(1 if fails else 0)
