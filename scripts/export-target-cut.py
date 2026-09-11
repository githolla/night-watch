"""Flatten the reach-out cut workbook into data/Nine67_Outbound_Targets_Cut.csv.

Run after replacing data/Nine67_Outbound_Targets_Cut.xlsx, then `npm run targets:generate`.
Needs openpyxl (`pip install openpyxl`). The CSV, not the workbook, is what the app reads.
"""
import csv
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "Nine67_Outbound_Targets_Cut.xlsx"
OUTPUT = ROOT / "data" / "Nine67_Outbound_Targets_Cut.csv"
SHEETS = [
    ("Tier A - Reach out", None),
    ("Tier B - Needs signal", "B"),
    ("Tier C - 1-5B stretch", "C"),
    ("Removed", "removed"),
]


def domain(website):
    value = (website or "").strip().lower()
    value = re.sub(r"^https?://", "", value)
    value = re.sub(r"^www\.", "", value)
    return re.sub(r"/.*$", "", value)


workbook = openpyxl.load_workbook(SOURCE, read_only=True)
rows = []
seen = set()
for sheet, fixed_tier in SHEETS:
    values = list(workbook[sheet].iter_rows(values_only=True))
    header = list(values[0])
    for record in values[1:]:
        if not any(record):
            continue
        item = dict(zip(header, record))
        tier = fixed_tier or item["priority"]
        website = domain(item["website"])
        if website in seen:
            raise SystemExit(f"{website} appears twice in the workbook")
        seen.add(website)
        rows.append({
            "tier": tier,
            "company": item["company"],
            "website": website,
            "drop_reason": item.get("drop_reason") or "",
        })

with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
    writer = csv.DictWriter(handle, fieldnames=["tier", "company", "website", "drop_reason"])
    writer.writeheader()
    writer.writerows(rows)
print(f"{len(rows)} companies written to {OUTPUT.relative_to(ROOT)}")
