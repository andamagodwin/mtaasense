"""Download the curated, openly licensed sample images from Wikimedia Commons.

    uv run python seed/fetch_images.py

Writes seed/images/<slug>.jpg (1600px wide renditions) and seed/images/sources.json with
title, author, licence and source page for each file. See seed/images/ATTRIBUTION.md.
"""

import json
import re
import sys
import time
from pathlib import Path

import httpx

UA = {"User-Agent": "MtaaSense/0.1 (Meta hackathon demo; https://github.com/andamagodwin/mtaasense)"}
OUT = Path(__file__).resolve().parent / "images"

# slug -> Commons file title
IMAGES = {
    "namanve-flood-a": "File:Flooded road Uganda.jpg",
    "namanve-flood-b": "File:Namanve Highway flooded.jpg",
    "wetland-road-flood": "File:Safe drive Uganda Flooded.jpg",
    "mukono-flood": "File:Kampala Flooding.jpg",
    "kamokya-drain-a": "File:Drainage channel in Kamokya, Kampala (4331539359).jpg",
    "kamokya-drain-b": "File:Drainage channel, solid waste heap and footpath in Kamokya, Kampala (4331538683).jpg",
    "natete-drain": "File:Drainage channel in Natete, Kampala (4332278352).jpg",
    "kalerwe-drain": "File:Garbage disposal in drainage channel along Kalerwe-Bwaise road, Kampala.jpg",
    "r36-pothole-a": "File:Big hol.jpg",
    "r36-pothole-b": "File:Better off than on.jpg",
    "r36-potholes-other": "File:More holes.jpg",
    "ghana-water-potholes": "File:Water-filled potholes on an unpaved road in Northern Ghana.jpg",
    "nigeria-pothole-road": "File:A Road filled with potholes.jpg",
    "truck-road-unclear": "File:African main road showing serious potholes.jpg",
    "chapati-irrelevant": "File:Chapati in uganda.JPG",
}


def _clean(md: dict[str, dict[str, str]], key: str) -> str:
    return re.sub(r"<[^>]+>", "", md.get(key, {}).get("value", "")).strip()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sources: dict[str, dict[str, object]] = {}
    with httpx.Client(headers=UA, timeout=60, follow_redirects=True) as client:
        for slug, title in IMAGES.items():
            info = client.get(
                "https://commons.wikimedia.org/w/api.php",
                params={
                    "action": "query",
                    "titles": title,
                    "prop": "imageinfo",
                    "iiprop": "url|size|extmetadata",
                    "iiurlwidth": 1600,
                    "format": "json",
                },
            ).json()
            page = next(iter(info["query"]["pages"].values()))
            if "imageinfo" not in page:
                print(f"missing: {title}", file=sys.stderr)
                continue
            ii = page["imageinfo"][0]
            md = ii["extmetadata"]
            target = OUT / f"{slug}.jpg"
            if not target.exists():
                target.write_bytes(client.get(ii["thumburl"]).content)
                time.sleep(0.5)
            sources[slug] = {
                "title": title,
                "source_page": ii["descriptionurl"],
                "author": _clean(md, "Artist"),
                "license": _clean(md, "LicenseShortName"),
                "license_url": _clean(md, "LicenseUrl"),
                "description": _clean(md, "ImageDescription")[:400],
                "original_size": [ii["width"], ii["height"]],
                "rendition": "1600px-wide rendition served by Wikimedia Commons",
            }
            print(f"{slug}: {sources[slug]['license']} — {sources[slug]['author']}")
    (OUT / "sources.json").write_text(json.dumps(sources, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
