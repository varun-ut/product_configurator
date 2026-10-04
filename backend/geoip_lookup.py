"""
geoip_lookup.py
---------------
Offline IP → (country, region, city) resolution for analytics ingest.

Reads a local MaxMind-format .mmdb (either MaxMind GeoLite2 City or DB-IP City
Lite — both use the same on-disk format and the geoip2 reader handles both) via
a single reader opened once and reused. There is **no network call on the hot
path**: a lookup is a memory-mapped file read (microseconds).

Hard rule: geo must NEVER block or break event capture. Every failure mode —
missing DB, unparseable/private IP, lookup miss, corrupt record — returns
(None, None, None). Nothing in here raises.

DB file:
- Path defaults to backend/data/geoip-city.mmdb, override with env GEOIP_DB_PATH.
- If the file is absent the module simply returns nulls (logged once), so the
  code is safe to deploy before the DB is in place.
- DB-IP City Lite is CC-BY-4.0 → attribution "IP Geolocation by DB-IP
  (https://db-ip.com)". Only relevant if the derived data is surfaced publicly;
  this feed is internal.
"""

import os
import ipaddress
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

_DEFAULT_DB = Path(__file__).parent / "data" / "geoip-city.mmdb"
_DB_PATH = os.environ.get("GEOIP_DB_PATH", str(_DEFAULT_DB))

# Reader is opened lazily on first lookup and cached. `_reader_tried` makes a
# missing/broken DB log exactly once instead of on every event.
_reader = None
_reader_tried = False


def _get_reader():
    global _reader, _reader_tried
    if _reader is not None or _reader_tried:
        return _reader
    _reader_tried = True
    try:
        import geoip2.database  # imported lazily so a missing dep can't crash import
        if not Path(_DB_PATH).exists():
            logger.warning("GeoIP DB not found at %s — geo fields will be null until it is added", _DB_PATH)
            return None
        _reader = geoip2.database.Reader(_DB_PATH)
        logger.info("GeoIP DB loaded from %s", _DB_PATH)
    except Exception as e:  # missing geoip2, unreadable file, etc.
        logger.warning("GeoIP reader init failed (%s) — geo fields will be null", e)
        _reader = None
    return _reader


def _normalize_public_ip(ip: str) -> Optional[str]:
    """Return the IP only if it's a valid, routable public address, else None.
    Private / loopback / link-local / reserved addresses can't be geolocated
    (and would otherwise resolve to nonsense), so they're treated as unknown."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if (addr.is_private or addr.is_loopback or addr.is_link_local
            or addr.is_reserved or addr.is_unspecified or addr.is_multicast):
        return None
    return str(addr)


def lookup(ip: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Resolve an IP to (country_iso2, region_name, city_name). Any element may be
    None; the whole tuple is (None, None, None) on any failure. Never raises.

    - country: ISO 3166-1 alpha-2 (e.g. "IN", "AE", "GB")
    - region:  most-specific subdivision name (e.g. "Maharashtra")
    - city:    city name (e.g. "Mumbai")
    """
    if not ip:
        return (None, None, None)
    clean = _normalize_public_ip(ip.strip())
    if not clean:
        return (None, None, None)
    reader = _get_reader()
    if reader is None:
        return (None, None, None)
    try:
        r = reader.city(clean)
        country = r.country.iso_code or None
        subdiv = r.subdivisions.most_specific if r.subdivisions else None
        region = (subdiv.name if subdiv else None) or None
        city = (r.city.name if r.city else None) or None
        return (country, region, city)
    except Exception:
        # geoip2.errors.AddressNotFoundError (IP not in DB) and anything else.
        return (None, None, None)
