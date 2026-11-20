#!/usr/bin/env python3
"""Refresh data/construction.js from OpenStreetMap via the Overpass API.

    python3 public-works/tools/fetch_construction.py

Mumbai is split into 24 small tiles (Overpass servers time out on the whole city). Each tile is
tried on several public mirrors. If any tile fails, the existing file is left unchanged, so a
partial download never replaces a complete one. Standard library only; needs node for the build step.
"""
import json, os, subprocess, sys, tempfile, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MIRRORS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
LAT0, LNG0, DLAT, DLNG = 18.89, 72.77, 0.065, 0.055


def fetch(bbox):
    q = ('[out:json][timeout:90];(way["landuse"="construction"](%s);way["building"="construction"](%s);'
         'relation["landuse"="construction"](%s););out tags center meta;') % (bbox, bbox, bbox)
    data = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(3):
        for m in MIRRORS:
            try:
                req = urllib.request.Request(m, data=data, headers={"User-Agent": "public-works-dashboard"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    j = json.load(r)
                if "elements" in j:
                    return j
            except Exception as e:  # noqa: BLE001
                print(f"  {m}: {e}", file=sys.stderr)
            time.sleep(4)
        time.sleep(20)
    return None


def main():
    tmp = tempfile.mkdtemp(prefix="osm-")
    files = []
    for i in range(6):
        for j in range(4):
            la, ln = round(LAT0 + i * DLAT, 3), round(LNG0 + j * DLNG, 3)
            bbox = f"{la},{ln},{round(la + DLAT, 3)},{round(ln + DLNG, 3)}"
            j_ = fetch(bbox)
            if j_ is None:
                sys.exit(f"tile {bbox} failed on every mirror; leaving data/construction.js unchanged")
            f = os.path.join(tmp, f"t{i}{j}.json")
            json.dump(j_, open(f, "w"))
            files.append(f)
            print(f"tile {bbox}: {len(j_['elements'])}", file=sys.stderr)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    subprocess.run(["node", os.path.join(HERE, "build-construction.cjs"), today] + files, check=True)


if __name__ == "__main__":
    main()
