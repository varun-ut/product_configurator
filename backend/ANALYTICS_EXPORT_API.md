# Analytics Export API

Machine-readable JSON feed of the UniVicoustic configurator's first-party
analytics event store. Intended for the central analytics web app to pull data
for its own storage / dashboards.

The store is a single append-only table of **events**. Every user interaction
in the configurator (page load, selection change, download, etc.) is one row.
There is no aggregation server-side — you receive the raw events and roll them
up however you like.

---

## Endpoint

```
GET https://api.univicoustic.com/api/admin/analytics/export
```

### Authentication

Send the shared secret **either** way:

- Query param: `?key=<TOKEN>`
- Header: `Authorization: Bearer <TOKEN>`

Two tokens are accepted (ask the configurator team which one you were given):

| Env var                  | Scope                                                        |
|--------------------------|-------------------------------------------------------------|
| `ANALYTICS_EXPORT_TOKEN` | Export-only. Preferred for this integration.                |
| `ADMIN_TOKEN`            | Full admin (also unlocks the internal HTML dashboard).      |

Responses:
- `200` — authorised, body as below.
- `401` — token missing or wrong.
- `404` — no token configured on the server (treat as "export disabled").

### Query parameters

| Param      | Type | Default | Notes                                                            |
|------------|------|---------|------------------------------------------------------------------|
| `since_id` | int  | `0`     | Return only events with `id` greater than this. Cursor for paging. |
| `limit`    | int  | `1000`  | Max rows per page. Clamped server-side to `1..10000`.            |

---

## Response envelope

```jsonc
{
  "meta": {
    "schema_version": 1,                       // bump signals a breaking change
    "generated_at": "2026-07-30T09:31:40.891169+00:00", // ISO-8601 UTC, response time
    "total_events": 1722,                      // total rows in the store right now
    "max_id": 1722                             // highest id right now = snapshot boundary
  },
  "pagination": {
    "since_id": 0,                             // echo of the request cursor
    "limit": 1000,                             // effective (post-clamp) limit
    "returned": 1000,                          // rows in THIS page
    "next_since_id": 1000,                     // feed back as `since_id` for the next page
    "has_more": true                           // false → you've reached the end
  },
  "events": [ /* Event objects, ascending by id */ ]
}
```

### Event object

| Field           | Type            | Always present | Meaning                                                                 |
|-----------------|-----------------|:--------------:|-------------------------------------------------------------------------|
| `id`            | integer         | yes            | Monotonic primary key. **Stable ordering key** and the paging cursor.   |
| `event_name`    | string          | yes            | What happened. See catalog below.                                       |
| `user_id`       | string \| null  | no             | The app user id. `null` until the visitor logs in.                      |
| `anon_id`       | string          | yes            | Stable per-browser UUID (survives across sessions on that device).      |
| `session_id`    | string          | yes            | Per-visit UUID. A new one is minted each session.                       |
| `properties`    | object \| null  | no             | Event-specific payload. Keys vary by `event_name` — treat as an open map. |
| `url`           | string \| null  | no             | Page URL when the event fired.                                          |
| `user_agent`    | string \| null  | no             | Browser UA, captured server-side (not spoofable by the client).         |
| `client_ts`     | integer \| null | no             | Client clock, epoch **ms**. May drift — do not rely on for ordering.    |
| `server_ts`     | integer         | yes            | Server clock, epoch **ms**. **Authoritative** timestamp.                |
| `server_ts_iso` | string          | yes            | `server_ts` rendered as ISO-8601 UTC, for convenience.                  |
| `country`       | string \| null  | yes            | Visitor country, **ISO 3166-1 alpha-2** (e.g. `IN`, `AE`, `GB`).        |
| `region`        | string \| null  | yes            | Region/state plain name (e.g. `Maharashtra`).                           |
| `city`          | string \| null  | yes            | City plain name (e.g. `Mumbai`).                                        |
| `profile`       | string \| null  | yes            | Professional role the user chose at sign-up. Fixed slug set — see below. |

Notes:
- Identity: `anon_id` groups a single browser; `user_id` groups a logged-in
  person across devices. A person's early (pre-login) events have `user_id: null`
  but share the `anon_id` — join on `user_id` when present, else `anon_id`.
- All timestamps are epoch **milliseconds** UTC (not seconds).
- `properties` is decoded from stored JSON into a real object for you. In the
  rare case a legacy row held non-JSON text, that field comes back as the raw
  string — code defensively.
- **Profile** (`profile`): the user's professional role, captured as an
  **optional** field on the sign-up form and stored on their account. The server
  stamps it onto every event from that user at ingest, so it is consistent
  across devices and re-logins and cannot be set by the client.
  Exactly one of these slugs, or `null`:

  | Slug                   | Meaning                         |
  |------------------------|---------------------------------|
  | `architect`            | Architect                       |
  | `interior_designer`    | Interior Designer               |
  | `pmc`                  | Project Management Consultant   |
  | `acoustic_consultant`  | Acoustic Consultant             |
  | `other`                | Other                           |

  `null` means: anonymous visitor (not logged in), an account that skipped the
  optional field, an account created before this feature shipped, or any event
  recorded before it shipped. Treat `null` as "unknown", not as a category —
  and expect a lot of it initially, since existing users were not backfilled.
  Map slugs to display names on your side; the slugs are the stable contract.

- **Geography** (`country`/`region`/`city`): resolved server-side from the
  visitor's IP at ingest time (offline MaxMind-format DB — no third-party call).
  The **IP itself is never stored or exported** — only these derived fields.
  Any of the three may be `null` when resolution fails or is imprecise (a correct
  `null` over a guess). `country` is the most reliable; `city` is best-effort.
  Events recorded **before** this feature shipped have all three `null` (no
  backfill). Country is alpha-2; for per-market rollups group by `country`.

---

## `properties` by `event_name`

The event set as observed in production. Keys can be **added** over time without
a `schema_version` bump, so treat `properties` as an open map and ignore keys
you don't recognise. `{}` means the event carries no properties.

| `event_name`              | `properties` keys                                                                                                   |
|---------------------------|---------------------------------------------------------------------------------------------------------------------|
| `configurator_loaded`     | `product_type, category, size, thickness, emboss`                                                                   |
| `preview_rendered`        | `surface, product_type, product_type_name, category, category_name, size, thickness, emboss_pattern`                |
| `product_type_selected`   | `from, to`                                                                                                           |
| `series_changed`          | `to, surface`                                                                                                       |
| `category_changed`        | `to, category_name, surface, product_type`                                                                          |
| `category_dwell`          | `category, category_name, surface, duration_ms, duration_seconds, ended_by`                                         |
| `design_selected`         | `design_id, design_code, design_name, product_type, category, surface`                                              |
| `color_swatch_clicked`    | `design_id, design_code, design_name, product_type, surface`                                                        |
| `emboss_pattern_selected` | `pattern_id, pattern_name, action, category, product_type`                                                          |
| `studio_lighting_toggled` | `mode`                                                                                                               |
| `zoom_in` / `zoom_out`    | `from, to`                                                                                                           |
| `download_clicked`        | `surface, product_type, product_type_name, category, category_name, design_code, size, thickness, emboss_pattern, download_scope` |
| `save_clicked`            | `surface, product_type, product_type_name, category, category_name, size, thickness, emboss_pattern, result`        |
| `saved_list_opened`       | `count`                                                                                                             |
| `tech_specs_viewed`       | `product_type, category, size, thickness, emboss`                                                                   |
| `compare_opened` / `compare_closed` | `{}`                                                                                                      |
| `reset_clicked`           | `product_type, category, size, thickness, emboss`                                                                   |
| `configuration_abandoned` | `surface, product_type, product_type_name, category, category_name, size, thickness, emboss_pattern, config_complete` |
| `user_identified`         | `email`  ⚠️ PII                                                                                                      |
| `user_logged_in`          | `method`                                                                                                            |
| `user_registered`         | `product_type, category, size, thickness, emboss`                                                                   |
| `user_logged_out`         | `product_type, category, size, thickness, emboss`                                                                   |

⚠️ **PII**: `user_identified.properties.email` and the `user_id` field are
personal data. Store and transmit accordingly.

---

## Pulling everything (and staying in sync)

Page forward on `id`. The cursor is durable: store the last `next_since_id` and
a later run picks up only new events — same loop does both the initial backfill
and incremental syncs.

```python
import requests

BASE  = "https://api.univicoustic.com/api/admin/analytics/export"
TOKEN = "..."                     # ANALYTICS_EXPORT_TOKEN
cursor = 0                        # load persisted cursor here on later runs

while True:
    r = requests.get(
        BASE,
        params={"since_id": cursor, "limit": 1000},
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()

    for ev in body["events"]:
        upsert(ev)                # keyed on ev["id"] — idempotent

    cursor = body["pagination"]["next_since_id"]
    persist_cursor(cursor)        # so the next run resumes here
    if not body["pagination"]["has_more"]:
        break
```

Guarantees that make this safe:
- **Idempotent**: `id` is a stable unique key. Re-fetching a page (retry, crash)
  and upserting on `id` never double-counts.
- **Append-only**: events are never updated or deleted, so a synced row never
  goes stale. You only ever fetch forward.
- **Consistent boundary**: `meta.max_id` is the highest id at query time. Rows
  that arrive mid-backfill just show up as higher ids on later pages — pin to
  `max_id` if you want a strict point-in-time snapshot.
- **Empty store**: `events: []`, `has_more: false`, `next_since_id` echoes your
  `since_id`.
