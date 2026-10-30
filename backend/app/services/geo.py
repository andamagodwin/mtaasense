import struct

from geoalchemy2 import WKBElement, WKTElement

# Uganda's bounding box with a margin; reports outside it are almost certainly mistakes.
UGANDA_BOUNDS = {"min_lat": -1.6, "max_lat": 4.4, "min_lon": 29.4, "max_lon": 35.2}


def point(lat: float, lon: float) -> WKTElement:
    return WKTElement(f"POINT({lon:.7f} {lat:.7f})", srid=4326)


def to_latlon(value: WKBElement | None) -> tuple[float, float] | None:
    """Decode an (E)WKB point to (lat, lon)."""
    if value is None:
        return None
    data = value.data
    raw = bytes.fromhex(data) if isinstance(data, str) else bytes(data)
    endian = "<" if raw[0] == 1 else ">"
    (geom_type,) = struct.unpack(endian + "I", raw[1:5])
    offset = 5
    if geom_type & 0x20000000:  # EWKB SRID flag
        offset += 4
    lon, lat = struct.unpack(endian + "dd", raw[offset : offset + 16])
    return lat, lon


def within_uganda(lat: float, lon: float) -> bool:
    b = UGANDA_BOUNDS
    return b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]


def copy_point(value: WKBElement | None) -> WKTElement | None:
    """Re-encode a loaded point so it can be assigned to another row (avoids a Shapely dependency)."""
    decoded = to_latlon(value)
    return point(*decoded) if decoded else None
