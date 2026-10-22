from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+psycopg2://parking:parking@localhost:5432/parking"

    # Auth
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12

    # QR signing
    qr_secret: str = "dev-qr-secret-change-me"
    qr_salt: str = "parking-qr"

    # MQTT
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_keepalive: int = 60
    mqtt_client_id: str = "parking-backend"

    # MQTT topics
    topic_sensor_wildcard: str = "parking/sensor/+/status"
    topic_sensor_prefix: str = "parking/sensor"
    topic_gate_command: str = "parking/gate/command"
    topic_gate_ack: str = "parking/gate/ack"
    # backend -> hardware: retained per-slot status the gateway turns into LED colours
    topic_slot_state_prefix: str = "parking/slot"
    # gateway -> backend: node boot / heartbeat
    topic_node_status_wildcard: str = "parking/node/+/status"
    # backend -> world: an operator forced a slot free (a real attendant would move the car)
    topic_admin_cleared: str = "parking/admin/slot_cleared"

    # A gate scan flips the slot state instantly, but the car needs a while to
    # drive to / out of the bay. Sensor readings that merely contradict the
    # scan during this window are ignored instead of undoing it.
    arrival_grace_seconds: float = 25.0
    departure_grace_seconds: float = 15.0

    # Parking lot
    total_slots: int = 20
    peak_threshold_pct: float = 85.0

    # ML
    ml_model_dir: str = "/app/ml_models"

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Admin (shared-secret header, not a per-user role -- this is a single-operator
    # demo tool, not a multi-admin production system)
    admin_token: str = "123456789"


@lru_cache
def get_settings() -> Settings:
    return Settings()
