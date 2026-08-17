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

# Inventory: row 4 is the shipped example row (Sailor, cost 168, price 340).
iv["A5"], iv["B5"], iv["C5"], iv["H5"], iv["J5"], iv["K5"], iv["M5"] = \
    "INK-KON", "Iroshizuku", "Kon-peki", 12, 25, 20, 10
iv["M4"] = 3                       # example row already has cost/price set

SHOW = "SF Pen Show"
# Sales: 1 Sailor @340 cash, 1 ink @25 cash, 2 Sailor @300 (discount 40 on line) card
rows = [
    ("2026-08-21", SHOW, "SAI-PROGEAR-M", 1, 340, 0,  "Yes", "Cash"),
    ("2026-08-21", SHOW, "INK-KON",       2, 25,  0,  "Yes", "Cash"),
    ("2026-08-22", SHOW, "SAI-PROGEAR-M", 1, 340, 40, "Yes", "Card"),
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
    ok = isinstance(got, float) and abs(got - want) <= tol
    print(("  ok   " if ok else "  FAIL ") + f"{label}: got {got!r}, want {want}")
    if not ok: fails.append(label)

print("--- Shows ---")
check("total show cost (I:N sum)", cell("Shows", "O4"), 830)

print("--- Sales Log line maths ---")
# row 4: 1 x 340, no discount
check("r4 line revenue",  cell("Sales Log", "J4"), 340)
check("r4 unit cost lookup", cell("Sales Log", "H4"), 168)
check("r4 sales tax @9.375%", cell("Sales Log", "K4"), 31.88)
check("r4 COGS", cell("Sales Log", "L4"), 168)
check("r4 card fee (cash -> 0)", cell("Sales Log", "P4"), 0)
check("r4 profit", cell("Sales Log", "M4"), 172)
check("r4 net to you", cell("Sales Log", "Q4"), 371.88)
# row 5: 2 x 25 ink
check("r5 line revenue", cell("Sales Log", "J5"), 50)
check("r5 unit cost lookup", cell("Sales Log", "H5"), 12)
check("r5 COGS", cell("Sales Log", "L5"), 24)
check("r5 tax", cell("Sales Log", "K5"), 4.69)
# row 6: 1 x 340 less 40 discount, paid by card
check("r6 revenue net of discount", cell("Sales Log", "J6"), 300)
check("r6 tax on discounted base", cell("Sales Log", "K6"), 28.13)
check("r6 card fee 2.6% + 0.10", cell("Sales Log", "P6"), round((300 + 28.13) * 0.026 + 0.10, 2))
check("r6 profit after card fee", cell("Sales Log", "M6"), 300 - 168 - 8.63)

print("--- Inventory rollups ---")
check("Sailor qty sold (SUMIFS)", cell("Inventory", "N4"), 2)
check("Sailor qty left", cell("Inventory", "O4"), 1)
check("Sailor margin @ price", cell("Inventory", "P4"), (340 - 168) / 340)
check("Sailor margin @ floor", cell("Inventory", "Q4"), (290 - 168) / 290)
check("Sailor cost tied up", cell("Inventory", "S4"), 168)
check("Ink qty sold", cell("Inventory", "N5"), 2)
check("Ink qty left", cell("Inventory", "O5"), 8)

print("--- Dashboard P&L ---")
rev, cogs = 340 + 50 + 300, 168 + 24 + 168
fee = round((300 + 28.13) * 0.026 + 0.10, 2)
check("units", cell("Dashboard", "C4"), 4)
check("revenue", cell("Dashboard", "D4"), rev)
check("COGS", cell("Dashboard", "E4"), cogs)
check("gross profit", cell("Dashboard", "F4"), rev - cogs)
check("margin %", cell("Dashboard", "G4"), (rev - cogs) / rev)
check("card fees", cell("Dashboard", "H4"), fee)
check("show costs pulled from Shows", cell("Dashboard", "I4"), 830)
check("NET PROFIT", cell("Dashboard", "J4"), rev - cogs - fee - 830)
check("break-even revenue", cell("Dashboard", "K4"), (830 + fee) / ((rev - cogs) / rev))
check("sales tax collected", cell("Dashboard", "L4"), 31.88 + 4.69 + 28.13)
check("cash reconciliation", cell("Dashboard", "M4"), 371.88 + 54.69)
check("card reconciliation", cell("Dashboard", "P4"), 300 + 28.13 - fee)

# SHOW_ROWS=2 in the small build, so the SEASON TOTAL row is row 6
print("--- Season total row ---")
check("total units", cell("Dashboard", "C6"), 4)
check("total revenue", cell("Dashboard", "D6"), rev)
check("total net profit", cell("Dashboard", "J6"), rev - cogs - fee - 830)
check("total margin recomputed, not summed", cell("Dashboard", "G6"), (rev - cogs) / rev)

print("--- Inventory position block ---")
# block starts at row tr+3 = 9, labels in A, values in B
check("SKUs listed", cell("Dashboard", "B10"), 2)
check("units brought", cell("Dashboard", "B11"), 13)     # 3 Sailor + 10 ink
check("units sold", cell("Dashboard", "B12"), 4)
check("units left", cell("Dashboard", "B13"), 9)
check("cost still on table", cell("Dashboard", "B14"), 1 * 168 + 8 * 12)
check("retail still on table", cell("Dashboard", "B15"), 1 * 340 + 8 * 25)
check("sell-through", cell("Dashboard", "B16"), 4 / 13)

print("\n=== formula failures: %d ===" % len(fails))
for f in fails: print(" -", f)
sys.exit(1 if fails else 0)
