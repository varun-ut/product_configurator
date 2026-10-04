"""
analytics_db.py
---------------
SQLite-backed event store for first-party analytics. Replaces the previous
PostHog integration.

Design notes:
- Single file (analytics.db) lives next to server.py.
- One writer (the FastAPI process), so SQLite is a comfortable fit. WAL mode
  is enabled for slightly smoother concurrent read/write behaviour during
  analyst queries that overlap with live writes.
- Schema is intentionally Postgres-friendly (no SQLite-only types) so a
  future migration is a clean pg_dump/load if write volume grows past
  what one SQLite writer can handle.
- properties is stored as JSON text in a TEXT column. SQLite has limited
  native JSON helpers; if you outgrow this, switch the column to jsonb on
  Postgres.

Querying for ad-hoc analysis:
    sqlite3 backend/analytics.db
    > SELECT event_name, COUNT(*) FROM events
        WHERE server_ts > strftime('%s','now','-7 day')*1000
        GROUP BY 1 ORDER BY 2 DESC;
"""

import sqlite3
import json
import threading
import time
from pathlib import Path
from typing import List, Dict, Optional, Any

DB_PATH = Path(__file__).parent / "analytics.db"

# Connections aren't thread-safe by default. Use a single shared connection
# guarded by a Lock — given the workload (low write rate, short statements)
# this is simpler and faster than per-request connections.
_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _init_schema(conn: sqlite3.Connection) -> None:
    # NOTE: the country/region/city columns are in the CREATE for fresh DBs, and
    # added to pre-existing DBs by _migrate() below. The country index is created
    # in _migrate() (not here) because on an OLD db the column doesn't exist yet
    # when this executescript runs.
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name  TEXT    NOT NULL,
      user_id     TEXT,
      anon_id     TEXT    NOT NULL,
      session_id  TEXT    NOT NULL,
      properties  TEXT,
      url         TEXT,
      user_agent  TEXT,
      client_ts   INTEGER,
      server_ts   INTEGER NOT NULL,
      country     TEXT,
      region      TEXT,
      city        TEXT,
      profile     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events (event_name, server_ts);
    CREATE INDEX IF NOT EXISTS idx_events_anon    ON events (anon_id);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id);
    """)
    _migrate(conn)


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive, idempotent schema upgrades for DBs created before a column
    existed. ALTER TABLE ADD COLUMN is metadata-only in SQLite (no table
    rewrite), so this is cheap even on a large events table. Existing rows get
    NULL for the new columns — no backfill."""
    existing = {row[1] for row in conn.execute("PRAGMA table_info(events)").fetchall()}
    for col in ("country", "region", "city", "profile"):
        if col not in existing:
            conn.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")
    # Safe now that the columns are guaranteed to exist.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_country ON events (country)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_profile ON events (profile)")


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(
            DB_PATH,
            check_same_thread=False,  # we guard with _lock instead
            isolation_level=None,     # autocommit; we manage transactions manually
        )
        _conn.execute("PRAGMA journal_mode=WAL;")
        _conn.execute("PRAGMA synchronous=NORMAL;")
        _init_schema(_conn)
    return _conn


# Hard cap on batch size to keep individual requests bounded.
MAX_BATCH = 100


def insert_events(rows: List[Dict[str, Any]]) -> int:
    """
    Insert a batch of events. Returns the count actually inserted.

    Each row should have at minimum: event_name, anon_id, session_id.
    Other supported keys: user_id, properties (dict or str), url,
    user_agent, client_ts (ms since epoch from the client clock).

    Server-side timestamp (server_ts, ms) is added automatically and is the
    authoritative ordering key — client clocks drift.
    """
    if not rows:
        return 0
    if len(rows) > MAX_BATCH:
        rows = rows[:MAX_BATCH]
    now_ms = int(time.time() * 1000)
    payload = []
    for r in rows:
        # Drop malformed rows individually rather than failing the batch.
        if not r.get("event_name") or not r.get("anon_id") or not r.get("session_id"):
            continue
        props = r.get("properties")
        if isinstance(props, (dict, list)):
            try:
                props = json.dumps(props, separators=(",", ":"))
            except (TypeError, ValueError):
                props = None
        elif props is not None:
            props = str(props)
        payload.append((
            r["event_name"],
            r.get("user_id"),
            r["anon_id"],
            r["session_id"],
            props,
            r.get("url"),
            r.get("user_agent"),
            r.get("client_ts"),
            now_ms,
            # Geo is resolved server-side from the request IP at ingest (see
            # geoip_lookup + the /api/events handler). The IP itself is never
            # stored — only these derived fields. Any may be None.
            r.get("country"),
            r.get("region"),
            r.get("city"),
            # Professional role, resolved server-side from the user's account
            # at ingest (see server.py post_events). None for anonymous users
            # and for accounts that never chose one.
            r.get("profile"),
        ))
    if not payload:
        return 0
    with _lock:
        conn = get_conn()
        conn.execute("BEGIN")
        try:
            conn.executemany("""
                INSERT INTO events
                  (event_name, user_id, anon_id, session_id, properties,
                   url, user_agent, client_ts, server_ts, country, region, city, profile)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, payload)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    return len(payload)


# Upper bound on rows returned by a single fetch_events_after() call, so one
# export request can never try to materialise the whole table at once.
MAX_EXPORT_LIMIT = 10000


def fetch_events_after(since_id: int = 0, limit: int = 1000) -> List[Dict[str, Any]]:
    """
    Return events with id > since_id, ordered by id ascending, up to `limit`
    rows (clamped to MAX_EXPORT_LIMIT). Uses the primary-key index, so paging
    stays fast regardless of table size.

    `properties` is parsed from its stored JSON text back into a Python object
    so callers get structured data rather than a string-inside-JSON. If a value
    somehow isn't valid JSON it's returned as the raw string; empty/NULL → None.

    This is the read side of the incremental export: a consumer pages forward
    by feeding the last id it saw back in as `since_id` until fewer than
    `limit` rows come back.
    """
    since_id = max(0, int(since_id))
    limit = max(1, min(int(limit), MAX_EXPORT_LIMIT))
    with _lock:
        conn = get_conn()
        rows = conn.execute(
            """
            SELECT id, event_name, user_id, anon_id, session_id, properties,
                   url, user_agent, client_ts, server_ts, country, region, city, profile
            FROM events
            WHERE id > ?
            ORDER BY id ASC
            LIMIT ?
            """,
            (since_id, limit),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        props = r[5]
        if props:
            try:
                props = json.loads(props)
            except (ValueError, TypeError):
                pass  # not valid JSON — hand back the raw stored string
        else:
            props = None
        out.append({
            "id": r[0],
            "event_name": r[1],
            "user_id": r[2],
            "anon_id": r[3],
            "session_id": r[4],
            "properties": props,
            "url": r[6],
            "user_agent": r[7],
            "client_ts": r[8],
            "server_ts": r[9],
            # Geo (resolved at ingest from the request IP). Null on historical
            # rows and whenever resolution failed. Never includes the IP itself.
            "country": r[10],
            "region": r[11],
            "city": r[12],
            # Professional role from the user's account (null for anonymous
            # visitors, accounts with no role set, and pre-feature events).
            "profile": r[13],
        })
    return out


def stats() -> Dict[str, int]:
    """
    Cheap store-wide counters used in export metadata:
      total_events — row count right now
      max_id       — highest event id right now (a stable snapshot boundary a
                     consumer can page up to for a point-in-time full pull)
    """
    with _lock:
        conn = get_conn()
        total = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        max_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM events").fetchone()[0]
    return {"total_events": int(total), "max_id": int(max_id)}
