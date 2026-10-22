"""HMAC-signed QR token payloads.

Each booking gets an opaque, tamper-proof token embedding the booking id.
`itsdangerous` signs it with a secret + salt so the gate can verify a scanned
token without a DB round trip before doing the real validation, and so a
guessed/forged booking id is rejected outright.
"""

from itsdangerous import BadSignature, URLSafeSerializer

from app.config import get_settings

settings = get_settings()

_serializer = URLSafeSerializer(settings.qr_secret, salt=settings.qr_salt)


def generate_qr_token(booking_id: int, slot_id: int) -> str:
    return _serializer.dumps({"booking_id": booking_id, "slot_id": slot_id})


def decode_qr_token(token: str) -> dict | None:
    try:
        data = _serializer.loads(token)
    except BadSignature:
        return None
    if not isinstance(data, dict) or "booking_id" not in data:
        return None
    return data
