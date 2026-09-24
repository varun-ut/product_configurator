"""
auth.py
=======
Frontend-only OTP-based authentication for the UniVicoustic configurator.

Flow per product decision:
  • Register: email → OTP sent (or printed to console in dev) → user enters
    the 6-digit code → account created, JWT returned.
  • Login:    email → JWT returned (NO verification step). This is intentionally
    insecure; the product owner accepted that anyone who knows a registered
    email can sign in as that user. The auth gate is here for soft access
    control (Save / Download / Compare gating), not as a true security
    boundary.

Storage:  SQLite at backend/auth.db (gitignored). Tiny dataset; migrate to
         Postgres/MySQL later if it ever matters.

Token:    HS256 JWT, signed with JWT_SECRET (env). 30-day TTL.

Email:    Tries real SMTP if SMTP_HOST/SMTP_USER/SMTP_PASSWORD are configured.
         Falls back to logging the OTP to the backend console. In dev mode
         (DEV_RETURN_OTP=1, default) the OTP is also returned in the API
         response so the frontend can prefill — never enabled in prod.
"""

import os
import smtplib
import secrets
import sqlite3
import logging
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent
DB_PATH = ROOT_DIR / "auth.db"

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me-in-production")
JWT_ALG = "HS256"
JWT_TTL_DAYS = 30

OTP_TTL_MINUTES = 10
OTP_LENGTH = 6
OTP_RESEND_COOLDOWN_SECONDS = 30

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USER
SMTP_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)
# When true (default in dev), the request-otp response includes the OTP so
# the frontend can pre-fill / show it. Set DEV_RETURN_OTP=0 in production.
DEV_RETURN_OTP_IN_RESPONSE = os.getenv("DEV_RETURN_OTP", "1") == "1"

# TEMPORARY master switch for the register OTP step. Default ON.  When set to
# OTP_ENABLED=0 (e.g. while the SendGrid subscription is lapsed and no code can
# be emailed), register/request-otp skips email verification entirely and logs
# the user straight in.  Re-enable email verification by removing this var or
# setting OTP_ENABLED=1.
OTP_ENABLED = os.getenv("OTP_ENABLED", "1") == "1"

# ── New-signup notification ────────────────────────────────────────────────
# Who gets told when a brand-new account is created.  Comma-separated so more
# recipients can be added by editing the server's .env alone — no code change,
# no redeploy.  Set SIGNUP_NOTIFY_TO to an empty string to switch the
# notification off entirely.
#
# Deliberately fires on account CREATION only, never on a returning user
# signing back in.  That distinction matters most while OTP_ENABLED=0, because
# the bypass path below serves both cases from the same endpoint — notifying on
# every call would mean one email per login rather than per signup.
SIGNUP_NOTIFY_TO = os.getenv("SIGNUP_NOTIFY_TO", "sukanya.d@united-group.in")

# Timestamps in the notification are rendered in IST: the people reading it are
# in India, and a UTC time would need mental arithmetic on every email.
IST = timezone(timedelta(hours=5, minutes=30))


# ── DB ──────────────────────────────────────────────────────────────────────
def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """Create tables if they don't exist. Idempotent — safe to call on every boot."""
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                email         TEXT NOT NULL UNIQUE,
                verified_at   TEXT NOT NULL,
                created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_login_at TEXT,
                -- Optional professional role chosen at sign-up. NULL = not given
                -- (the field is never mandatory). See PROFILE_VALUES below.
                profile       TEXT,
                -- Marketing email opt-in from the sign-up checkbox. Stored as
                -- 0/1; NULL means the account predates the checkbox, which is
                -- deliberately NOT the same as an explicit "no" — see the
                -- migration note below.
                marketing_consent INTEGER,
                -- First-touch attribution, captured in the browser and sent
                -- once at registration (see frontend/src/lib/attribution.js).
                -- Describes where the ACCOUNT came from, so it is written on
                -- creation only and never updated by a later login.
                signup_source      TEXT,
                signup_medium      TEXT,
                signup_campaign    TEXT,
                signup_content     TEXT,
                signup_landing_url TEXT,
                signup_referrer    TEXT,
                signup_at          TEXT
            );

            CREATE TABLE IF NOT EXISTS otps (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                email       TEXT NOT NULL,
                code        TEXT NOT NULL,
                -- only 'register' is used today; leaving the column open in case
                -- we add OTP-based login later.
                purpose     TEXT NOT NULL DEFAULT 'register',
                expires_at  TEXT NOT NULL,
                consumed_at TEXT,
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_otps_email   ON otps(email);
            CREATE INDEX IF NOT EXISTS idx_otps_expires ON otps(expires_at);
            """
        )
        # Additive migration for DBs created before `profile` existed. SQLite's
        # ADD COLUMN is metadata-only (no table rewrite); existing users get
        # NULL, i.e. "no profile given" — no backfill, nothing to migrate.
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "profile" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN profile TEXT")
        # Same additive pattern for the marketing opt-in. Existing accounts get
        # NULL, meaning "never asked" — left deliberately distinct from 0
        # ("asked, said no"). Both are withheld from Brevo, but only NULL can
        # honestly be re-asked later, so the two must not be conflated.
        if "marketing_consent" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN marketing_consent INTEGER")
        # Attribution columns, same additive pattern. Existing accounts stay
        # NULL — we genuinely do not know where they came from, and guessing
        # would poison the campaign numbers these columns exist to produce.
        for col in ("signup_source", "signup_medium", "signup_campaign",
                    "signup_content", "signup_landing_url", "signup_referrer",
                    "signup_at"):
            if col not in cols:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")


init_db()


# Accepted profile slugs. Anything else (typo, junk, injected value) is stored
# as NULL rather than trusted — the client picks from a fixed dropdown, so an
# off-list value can only be a bug or someone poking the API by hand.
PROFILE_VALUES = {
    "architect",
    "interior_designer",
    "pmc",
    "acoustic_consultant",
    "other",
}


# Slug → human label.  Profiles are stored as slugs, so anything shown to a
# person has to be mapped back first.  server.py carries its own copies of this
# for the dashboard tables; this one exists next to PROFILE_VALUES because that
# is where the slugs are defined.
PROFILE_LABELS = {
    "architect": "Architect",
    "interior_designer": "Interior Designer",
    "pmc": "Project Management Consultant",
    "acoustic_consultant": "Acoustic Consultant",
    "other": "Other",
}


# Attribution values come straight from a URL the visitor followed, so they are
# arbitrary client input. Keep them short and stringy: they are for grouping in
# reports, and an unbounded value would just bloat every row.
_SOURCE_FIELDS = ("source", "medium", "campaign", "content", "landing", "referrer", "at")
_SOURCE_MAX = 500


def _clean_source(raw: Optional[dict]) -> dict:
    """Whitelist + truncate the client-supplied attribution blob.

    Returns a dict with every key present (value or None) so callers can index
    it without guarding. Anything not in _SOURCE_FIELDS is dropped.
    """
    out = {k: None for k in _SOURCE_FIELDS}
    if not isinstance(raw, dict):
        return out
    for k in _SOURCE_FIELDS:
        v = raw.get(k)
        if v is None:
            continue
        v = str(v).strip()
        out[k] = v[:_SOURCE_MAX] if v else None
    return out


def normalize_profile(profile: Optional[str]) -> Optional[str]:
    """Whitelist a client-supplied profile slug. Returns None when absent or
    unrecognised — the field is optional, so None is always a valid outcome."""
    if not profile:
        return None
    p = str(profile).strip().lower()
    return p if p in PROFILE_VALUES else None


def get_profiles_for_user_ids(user_ids) -> dict:
    """Map {user_id(str) → profile} for the given ids, skipping users with no
    profile set. Used by the analytics ingest to stamp each event with the
    account's profile (see server.py post_events).

    Returns {} on any error — analytics must never be able to break, and a
    missing profile is a valid state anyway.
    """
    ids = [int(i) for i in {u for u in user_ids if u is not None and str(u).isdigit()}]
    if not ids:
        return {}
    try:
        with _connect() as conn:
            rows = conn.execute(
                f"SELECT id, profile FROM users WHERE id IN ({','.join('?' * len(ids))})",
                ids,
            ).fetchall()
        return {str(r["id"]): r["profile"] for r in rows if r["profile"]}
    except Exception as e:  # pragma: no cover - defensive
        logger.warning(f"profile lookup failed: {e!r}")
        return {}


# ── Helpers ─────────────────────────────────────────────────────────────────
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def generate_otp() -> str:
    """6-digit numeric OTP, zero-padded. `secrets` is CSPRNG-backed."""
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def issue_jwt(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": int(now_utc().timestamp()),
        "exp": int((now_utc() + timedelta(days=JWT_TTL_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Email delivery ──────────────────────────────────────────────────────────

# Logo embedded inline via Content-ID so it renders even when recipients have
# "block external images" turned on (default for many Gmail/Outlook setups).
# Loaded once at module import — the file rarely changes; if it ever does,
# restart the backend.
_LOGO_PATH = ROOT_DIR / "static" / "email" / "logo.png"
try:
    with open(_LOGO_PATH, "rb") as _f:
        _LOGO_BYTES = _f.read()
except FileNotFoundError:
    _LOGO_BYTES = None
    logger.warning(f"OTP logo not found at {_LOGO_PATH} — emails will render without it.")


def _build_html_body(code: str) -> str:
    """Brand-styled HTML body for the OTP email. (Logo is intentionally
    omitted — when ready, drop a file at static/email/logo.png and re-add
    the cid:logo <img> + add_related() call in send_otp_email.)"""
    return f"""\
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
             max-width: 480px; margin: 40px auto; padding: 0 24px; color: #2a3142;">
  <h2 style="font-weight: 600; color: #2a3142; text-align: center;">Verify your email</h2>
  <p style="text-align: center;">Use the code below to finish creating your UniVicoustic account:</p>

  <div style="background: #f5f2ee; border: 2px solid #c4956a;
              border-radius: 8px; padding: 20px; text-align: center;
              font-family: 'Courier New', monospace; font-size: 28px;
              font-weight: 700; letter-spacing: 6px;
              color: #c4956a; margin: 24px 0;">
    {code}
  </div>

  <p style="color: #6b7280; font-size: 14px; text-align: center;">
    This code expires in {OTP_TTL_MINUTES} minutes.<br>
    If you didn't request this, you can safely ignore this email.
  </p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
  <p style="color: #9ca3af; font-size: 12px; text-align: center;">
    UniVicoustic &middot; Acoustic walls, designed your way
  </p>
</body>
</html>
"""


def send_otp_email(to_email: str, code: str) -> dict:
    """
    Try SMTP if configured; fall back to logging the code to the backend console.
    Returns a small status dict so the API can report which path was used.
    """
    delivered_via = "console"  # default fallback

    if SMTP_ENABLED:
        try:
            msg = EmailMessage()
            # Subject lines that include the code itself measurably improve
            # open rates because recipients can read it from their inbox preview.
            msg["Subject"] = f"{code} is your UniVicoustic code"
            # Friendly From: name + email so recipients see "UniVicoustic" in
            # their inbox list, not just an opaque address.
            msg["From"] = f"UniVicoustic <{SMTP_FROM}>"
            msg["To"] = to_email
            # Plain-text fallback — required for accessibility and older clients.
            msg.set_content(
                f"Your UniVicoustic verification code is: {code}\n\n"
                f"It expires in {OTP_TTL_MINUTES} minutes.\n\n"
                "If you didn't request this, you can safely ignore this email."
            )
            # HTML alternative — preferred render in modern clients.
            msg.add_alternative(_build_html_body(code), subtype="html")
            # Logo intentionally not attached — when ready, re-enable by
            # uncommenting and ensuring _build_html_body includes <img src="cid:logo">.
            # if _LOGO_BYTES:
            #     html_part = msg.get_payload()[-1]
            #     html_part.add_related(_LOGO_BYTES, maintype="image", subtype="png",
            #                           cid="<logo>", filename="logo.png")
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
                s.starttls()
                s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(msg)
            delivered_via = "smtp"
            logger.info(f"OTP emailed to {to_email}")
        except Exception as e:
            logger.warning(f"SMTP send failed for {to_email}: {e!r}. Falling back to console.")

    if delivered_via == "console":
        # Conspicuous block so the OTP is easy to find in the backend log
        # during dev. Production should always have SMTP configured.
        logger.warning(
            "\n%s\n  DEV OTP for %s: %s\n  (would be emailed in production)\n%s",
            "=" * 50,
            to_email,
            code,
            "=" * 50,
        )

    return {"delivered_via": delivered_via}


def _signup_notification_html(email: str, role: str, when: str, total_users: int) -> str:
    """Brand-styled body for the internal new-signup alert."""
    return f"""\
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
             max-width: 520px; margin: 40px auto; padding: 0 24px; color: #2a3142;">
  <h2 style="font-weight: 600; color: #2a3142;">New sign-up</h2>
  <p style="color: #6b7280;">Someone just created a UniVicoustic configurator account.</p>

  <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 40%;">Email</td>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">{email}</td>
    </tr>
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Profile</td>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">{role}</td>
    </tr>
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Signed up</td>
      <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">{when}</td>
    </tr>
    <tr>
      <td style="padding: 10px 0; color: #6b7280;">Total users</td>
      <td style="padding: 10px 0; font-weight: 600;">{total_users}</td>
    </tr>
  </table>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
  <p style="color: #9ca3af; font-size: 12px;">
    Automated notification from the UniVicoustic configurator.
  </p>
</body>
</html>
"""


def _send_signup_notification(email: str, profile: Optional[str], total_users: int) -> None:
    """Blocking send — always called on a background thread by notify_new_signup."""
    recipients = [a.strip() for a in (SIGNUP_NOTIFY_TO or "").split(",") if a.strip()]
    if not recipients:
        return
    if not SMTP_ENABLED:
        logger.info("New signup: %s (profile=%s) — SMTP not configured, no alert sent.",
                    email, profile or "-")
        return

    # Profiles are stored as slugs ("pmc"), so map to the display label the
    # dashboard uses rather than emailing a raw slug to a human.
    role = PROFILE_LABELS.get(profile, profile) if profile else "Not specified"
    when = now_utc().astimezone(IST).strftime("%d %b %Y, %I:%M %p IST")

    msg = EmailMessage()
    msg["Subject"] = f"New UniVicoustic signup: {email}"
    msg["From"] = f"UniVicoustic <{SMTP_FROM}>"
    msg["To"] = ", ".join(recipients)
    # Replies should reach the person who signed up, not the unattended noreply
    # mailbox — makes the alert directly actionable for the sales follow-up.
    msg["Reply-To"] = email
    msg.set_content(
        f"New UniVicoustic configurator sign-up.\n\n"
        f"Email:       {email}\n"
        f"Profile:     {role}\n"
        f"Signed up:   {when}\n"
        f"Total users: {total_users}\n"
    )
    msg.add_alternative(
        _signup_notification_html(email, role, when, total_users), subtype="html"
    )

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        s.starttls()
        s.login(SMTP_USER, SMTP_PASSWORD)
        s.send_message(msg)
    logger.info("Signup alert for %s sent to %s", email, ", ".join(recipients))


def notify_new_signup(email: str, profile: Optional[str], total_users: int) -> None:
    """
    Tell the team a new account was created.  Fire-and-forget by design.

    Runs on a daemon thread so a slow or failing SMTP handshake can never delay
    — let alone fail — the sign-up request that triggered it.  An internal
    notification is not worth blocking a user's registration on, so every error
    is swallowed into the log.
    """
    def run():
        try:
            _send_signup_notification(email, profile, total_users)
        except Exception as e:
            logger.warning("Signup alert for %s failed: %r", email, e)

    threading.Thread(target=run, name=f"signup-alert-{email}", daemon=True).start()


# ── Request / Response models ──────────────────────────────────────────────
class RequestOtpBody(BaseModel):
    email: EmailStr
    # Optional professional role picked on the sign-up form. Always optional;
    # sent on both register steps so it survives the OTP round-trip.
    profile: Optional[str] = None
    # Marketing opt-in from the sign-up checkbox. A separate top-level field:
    # `profile` above is a role slug string, so this cannot be nested under it.
    # Defaults to False so an older client that omits it is treated as no
    # consent rather than silently opting the user in.
    marketing_consent: bool = False
    # First-touch attribution captured in the browser. A dict, not a string —
    # unlike `profile`, this genuinely is a nested object. Untrusted client
    # input, so every field is length-capped before storage (see _clean_source).
    signup_source: Optional[dict] = None


class VerifyOtpBody(BaseModel):
    email: EmailStr
    otp: str
    profile: Optional[str] = None
    marketing_consent: bool = False
    signup_source: Optional[dict] = None


class LoginBody(BaseModel):
    email: EmailStr


# ── Router ──────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)


@router.post("/register/request-otp")
def register_request_otp(body: RequestOtpBody) -> dict:
    """Generate + send a register OTP for the given email."""
    email = normalize_email(body.email)

    # ── TEMPORARY OTP BYPASS (OTP_ENABLED=0) ────────────────────────────────
    # Email verification is turned off (SendGrid subscription lapsed). Skip the
    # code entirely: create the user if new, otherwise reuse the existing
    # account, and return a JWT immediately — the same shape verify-otp returns.
    # The frontend sees the `token` and skips the code-entry screen.
    # To restore email verification: set OTP_ENABLED=1 (or remove the var).
    if not OTP_ENABLED:
        profile = normalize_profile(body.profile)
        marketing_consent = bool(body.marketing_consent)
        src = _clean_source(body.signup_source)
        # With the OTP step bypassed this single endpoint serves BOTH a genuine
        # sign-up and a returning user coming back through the sign-up form.
        # Only the former is worth an alert, so track which happened.
        is_new_user = False
        total_users = 0
        with _connect() as conn:
            existing = conn.execute(
                "SELECT id, profile, marketing_consent, signup_source, signup_campaign "
                "FROM users WHERE email = ?", (email,)
            ).fetchone()
            if existing:
                user_id = existing["id"]
                conn.execute(
                    "UPDATE users SET last_login_at = ? WHERE id = ?",
                    (iso(now_utc()), user_id),
                )
                # Don't clobber an existing profile with an empty one; a newly
                # supplied value does update it.
                if profile:
                    conn.execute("UPDATE users SET profile = ? WHERE id = ?", (profile, user_id))
                else:
                    profile = existing["profile"]
                # A returning user coming back through the sign-up form has the
                # checkbox in front of them again, so their answer — ticked or
                # not — is a fresh, explicit choice and replaces the stored one.
                # This is how an opt-out actually happens.
                conn.execute(
                    "UPDATE users SET marketing_consent = ? WHERE id = ?",
                    (1 if marketing_consent else 0, user_id),
                )
                marketing_consent = bool(marketing_consent)
                # Attribution is first-touch: a returning user keeps the
                # source their account was created with, whatever this
                # browser happens to say today.
                src = {**src, "source": existing["signup_source"],
                       "campaign": existing["signup_campaign"]}
            else:
                cur = conn.execute(
                    "INSERT INTO users (email, verified_at, last_login_at, profile, marketing_consent, "
                    "signup_source, signup_medium, signup_campaign, signup_content, signup_landing_url, signup_referrer, signup_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (email, iso(now_utc()), iso(now_utc()), profile,
                     1 if marketing_consent else 0,
                     src["source"], src["medium"], src["campaign"], src["content"],
                     src["landing"], src["referrer"], src["at"] or iso(now_utc())),
                )
                user_id = cur.lastrowid
                is_new_user = True
                total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        # Outside the `with` so the row is committed before the alert reports it.
        if is_new_user:
            notify_new_signup(email, profile, total_users)
        token = issue_jwt(user_id, email)
        return {
            "ok": True,
            "otp_bypassed": True,
            "token": token,
            "user": {"id": user_id, "email": email, "profile": profile,
                     "marketing_consent": marketing_consent,
                     "signup_source": src["source"],
                     "signup_campaign": src["campaign"]},
        }
    # ── end bypass ──────────────────────────────────────────────────────────

    with _connect() as conn:
        # Already-registered users should use the login flow instead.
        if conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
            raise HTTPException(
                status_code=409,
                detail="Email is already registered. Use the Sign in flow instead.",
            )

        # Resend cooldown — protects against accidental spam from rapid clicks.
        recent = conn.execute(
            "SELECT created_at FROM otps WHERE email = ? AND purpose = 'register' "
            "ORDER BY id DESC LIMIT 1",
            (email,),
        ).fetchone()
        if recent:
            recent_dt = datetime.fromisoformat(recent["created_at"])
            if recent_dt.tzinfo is None:
                recent_dt = recent_dt.replace(tzinfo=timezone.utc)
            elapsed = (now_utc() - recent_dt).total_seconds()
            if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
                wait = int(OTP_RESEND_COOLDOWN_SECONDS - elapsed)
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {wait}s before requesting another code.",
                )

        # Invalidate prior unconsumed OTPs so only the newest is valid.
        conn.execute(
            "UPDATE otps SET consumed_at = ? "
            "WHERE email = ? AND purpose = 'register' AND consumed_at IS NULL",
            (iso(now_utc()), email),
        )

        code = generate_otp()
        expires = iso(now_utc() + timedelta(minutes=OTP_TTL_MINUTES))
        conn.execute(
            "INSERT INTO otps (email, code, purpose, expires_at) "
            "VALUES (?, ?, 'register', ?)",
            (email, code, expires),
        )

    delivery = send_otp_email(email, code)

    resp = {
        "ok": True,
        "delivered_via": delivery["delivered_via"],
        "expires_in_minutes": OTP_TTL_MINUTES,
        "resend_cooldown_seconds": OTP_RESEND_COOLDOWN_SECONDS,
    }
    # Dev convenience: include the OTP in the response when SMTP isn't wired
    # so the frontend can show it / pre-fill it. Disable with DEV_RETURN_OTP=0.
    if DEV_RETURN_OTP_IN_RESPONSE and delivery["delivered_via"] == "console":
        resp["_dev_otp"] = code
    return resp


@router.post("/register/verify-otp")
def register_verify_otp(body: VerifyOtpBody) -> dict:
    """Verify OTP, create the user (if new), return a JWT."""
    email = normalize_email(body.email)
    code = body.otp.strip()

    with _connect() as conn:
        otp_row = conn.execute(
            "SELECT id, code, expires_at FROM otps "
            "WHERE email = ? AND purpose = 'register' AND consumed_at IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (email,),
        ).fetchone()
        if not otp_row:
            raise HTTPException(
                status_code=400,
                detail="No active code for this email. Request a new one.",
            )

        expires_at = datetime.fromisoformat(otp_row["expires_at"])
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if now_utc() > expires_at:
            raise HTTPException(
                status_code=400,
                detail="Code has expired. Request a new one.",
            )
        if otp_row["code"] != code:
            raise HTTPException(status_code=400, detail="Incorrect code.")

        # Consume the OTP and create the user record (idempotent).
        conn.execute(
            "UPDATE otps SET consumed_at = ? WHERE id = ?",
            (iso(now_utc()), otp_row["id"]),
        )
        profile = normalize_profile(body.profile)
        marketing_consent = bool(body.marketing_consent)
        src = _clean_source(body.signup_source)
        # Same new-vs-returning distinction as the bypass path above, so the
        # alert keeps working identically if OTP_ENABLED is turned back on.
        is_new_user = False
        total_users = 0
        existing = conn.execute(
            "SELECT id, profile, marketing_consent, signup_source, signup_campaign "
                "FROM users WHERE email = ?", (email,)
        ).fetchone()
        if existing:
            user_id = existing["id"]
            conn.execute(
                "UPDATE users SET last_login_at = ? WHERE id = ?",
                (iso(now_utc()), user_id),
            )
            if profile:
                conn.execute("UPDATE users SET profile = ? WHERE id = ?", (profile, user_id))
            else:
                profile = existing["profile"]
            # Same as the bypass path: they just saw the checkbox, so their
            # answer replaces whatever was stored.
            conn.execute(
                "UPDATE users SET marketing_consent = ? WHERE id = ?",
                (1 if marketing_consent else 0, user_id),
            )
            marketing_consent = bool(marketing_consent)
            src = {**src, "source": existing["signup_source"],
                   "campaign": existing["signup_campaign"]}
        else:
            cur = conn.execute(
                "INSERT INTO users (email, verified_at, last_login_at, profile, marketing_consent, "
                "signup_source, signup_medium, signup_campaign, signup_content, signup_landing_url, signup_referrer, signup_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (email, iso(now_utc()), iso(now_utc()), profile,
                 1 if marketing_consent else 0,
                 src["source"], src["medium"], src["campaign"], src["content"],
                     src["landing"], src["referrer"], src["at"] or iso(now_utc())),
            )
            user_id = cur.lastrowid
            is_new_user = True
            total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    if is_new_user:
        notify_new_signup(email, profile, total_users)

    token = issue_jwt(user_id, email)
    return {"token": token, "user": {"id": user_id, "email": email, "profile": profile,
                                     "marketing_consent": marketing_consent,
                                     "signup_source": src["source"],
                                     "signup_campaign": src["campaign"]}}


@router.post("/login")
def login(body: LoginBody) -> dict:
    """
    Email-only login. Intentionally insecure per product decision —
    anyone who knows a registered email can sign in as them. Suitable
    for soft gating (saved configs, downloads), NOT for protecting
    sensitive data.
    """
    email = normalize_email(body.email)

    with _connect() as conn:
        user = conn.execute(
            "SELECT id, email, profile, marketing_consent, signup_source, signup_campaign "
            "FROM users WHERE email = ?", (email,)
        ).fetchone()
        if not user:
            raise HTTPException(
                status_code=404,
                detail="No account with that email. Please sign up first.",
            )
        conn.execute(
            "UPDATE users SET last_login_at = ? WHERE id = ?",
            (iso(now_utc()), user["id"]),
        )

    token = issue_jwt(user["id"], email)
    # Login doesn't ask about marketing — it reports what is stored. NULL
    # (never asked) is passed through as None, distinct from False.
    _mc = user["marketing_consent"]
    return {"token": token, "user": {"id": user["id"], "email": email, "profile": user["profile"],
                                     "marketing_consent": None if _mc is None else bool(_mc),
                                     "signup_source": user["signup_source"],
                                     "signup_campaign": user["signup_campaign"]}}


@router.get("/me")
def me(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """Decode the bearer token and return the user it identifies. 401 if missing/invalid/expired."""
    if not creds:
        raise HTTPException(status_code=401, detail="Missing token")
    payload = decode_jwt(creds.credentials)
    user_id = int(payload["sub"])
    # Profile isn't in the JWT (it can change after the token was issued), so
    # read it live. A missing row just yields None — /me stays a pure decode.
    profile = None
    try:
        with _connect() as conn:
            row = conn.execute("SELECT profile FROM users WHERE id = ?", (user_id,)).fetchone()
        if row:
            profile = row["profile"]
    except Exception as e:  # pragma: no cover - defensive
        logger.warning(f"/me profile lookup failed: {e!r}")
    return {"id": user_id, "email": payload["email"], "profile": profile}
