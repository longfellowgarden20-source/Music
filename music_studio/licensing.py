"""
License gate for the sellable desktop build.

Flow:
  1. Customer buys StemAI on Gumroad → receives a license key.
  2. On first launch they paste the key. We POST it to Gumroad's public
     license-verify API to confirm it's a real, non-refunded purchase.
  3. On success we write a local activation file so the app works fully
     offline from then on (no phone-home on every launch).

The activation file is HMAC-signed with a per-machine secret so it can't be
copied to another machine by hand-editing, but this is a $49 product — the
goal is honest-customer friction, not unbreakable DRM.
"""
from __future__ import annotations
import os
import json
import time
import hmac
import hashlib
import platform
import urllib.request
import urllib.parse

# Your Gumroad product permalink — the slug at the end of the product URL,
# e.g. gumroad.com/l/stemai  →  "stemai". Set via env so the same code works
# across test/prod without editing source.
GUMROAD_PRODUCT_ID = os.environ.get("STEMAI_GUMROAD_PRODUCT", "")
GUMROAD_VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify"

# Where the activation lives, in the user's home — survives app updates.
_CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".stemai")
_ACTIVATION_FILE = os.path.join(_CONFIG_DIR, "activation.json")


def _machine_secret() -> bytes:
    """A stable per-machine secret used to sign the activation file.

    Derived from a hardware-ish identifier so an activation copied to another
    machine fails signature verification. Not cryptographically perfect — good
    enough to stop casual sharing.
    """
    seed = "|".join([
        platform.node(),
        platform.machine(),
        platform.system(),
        os.environ.get("STEMAI_SALT", "stemai-v1"),
    ])
    return hashlib.sha256(seed.encode()).digest()


def _sign(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hmac.new(_machine_secret(), raw, hashlib.sha256).hexdigest()


def _write_activation(key: str, gumroad_meta: dict) -> None:
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    payload = {
        "key": key,
        "activated_at": int(time.time()),
        "email": gumroad_meta.get("email", ""),
        "product": GUMROAD_PRODUCT_ID,
    }
    record = {"payload": payload, "sig": _sign(payload)}
    with open(_ACTIVATION_FILE, "w") as f:
        json.dump(record, f, indent=2)


def is_activated() -> bool:
    """True if a valid, signature-matching activation exists locally."""
    try:
        with open(_ACTIVATION_FILE) as f:
            record = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return False
    payload = record.get("payload")
    sig = record.get("sig")
    if not isinstance(payload, dict) or not sig:
        return False
    return hmac.compare_digest(_sign(payload), sig)


def activation_info() -> dict | None:
    """The stored activation payload, or None if not activated."""
    if not is_activated():
        return None
    with open(_ACTIVATION_FILE) as f:
        return json.load(f)["payload"]


def _verify_with_gumroad(key: str) -> dict:
    """Call Gumroad. Returns the purchase dict on success; raises ValueError."""
    if not GUMROAD_PRODUCT_ID:
        raise ValueError("Product not configured. Set STEMAI_GUMROAD_PRODUCT.")
    data = urllib.parse.urlencode({
        "product_id": GUMROAD_PRODUCT_ID,
        "license_key": key.strip(),
        # don't bump the use-count on every verify; we only care that it's valid
        "increment_uses_count": "false",
    }).encode()
    reqx = urllib.request.Request(GUMROAD_VERIFY_URL, data=data)
    try:
        with urllib.request.urlopen(reqx, timeout=15) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        # Gumroad returns 404 with {"success": false} for bad keys
        try:
            body = json.loads(e.read().decode())
        except Exception:
            raise ValueError("Could not reach the license server. Check your connection.")
    except Exception:
        raise ValueError("Could not reach the license server. Check your connection.")

    if not body.get("success"):
        raise ValueError(body.get("message") or "Invalid license key.")

    purchase = body.get("purchase", {})
    if purchase.get("refunded") or purchase.get("chargebacked"):
        raise ValueError("This purchase was refunded and is no longer valid.")
    if purchase.get("disputed"):
        raise ValueError("This purchase is under dispute.")
    return purchase


# Owner/dev master key — activates without contacting Gumroad. Lets you (and
# support, for refunds/comps) get into the app without a real purchase. Override
# per-build with STEMAI_MASTER_KEY; the default below is fine for personal use.
MASTER_KEY = os.environ.get("STEMAI_MASTER_KEY", "STEMAI-OWNER-UNLOCK-2026")


def activate(key: str) -> dict:
    """Verify a key with Gumroad and persist activation. Returns activation info.

    Raises ValueError with a user-facing message on any failure.
    """
    key = (key or "").strip()
    if not key:
        raise ValueError("Please enter your license key.")
    # Master key bypasses Gumroad (owner/support/comp use).
    if hmac.compare_digest(key, MASTER_KEY):
        _write_activation(key, {"email": "owner@stemai", "refunded": False})
        return activation_info()
    purchase = _verify_with_gumroad(key)
    _write_activation(key, purchase)
    return activation_info()


def deactivate() -> None:
    """Remove local activation (for support / transferring machines)."""
    try:
        os.remove(_ACTIVATION_FILE)
    except FileNotFoundError:
        pass
