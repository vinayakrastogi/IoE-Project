"""Thin wrapper around a single shared paho-mqtt client used for publishing
commands from API request handlers (e.g. "open gate"). The subscriber side
(sensor ingestion) lives in app.mqtt.worker and runs its own connection on a
background thread.
"""

import json
import logging

import paho.mqtt.client as mqtt

from app.config import get_settings

logger = logging.getLogger("mqtt.publisher")
settings = get_settings()

_client: mqtt.Client | None = None


def get_publisher() -> mqtt.Client:
    global _client
    if _client is None:
        _client = mqtt.Client(
            client_id=f"{settings.mqtt_client_id}-pub",
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        _client.connect(settings.mqtt_host, settings.mqtt_port, settings.mqtt_keepalive)
        _client.loop_start()
    return _client


def publish_json(topic: str, payload: dict, retain: bool = False) -> None:
    client = get_publisher()
    client.publish(topic, json.dumps(payload), qos=1, retain=retain)
    logger.info("published to %s: %s", topic, payload)


def shutdown_publisher() -> None:
    global _client
    if _client is not None:
        _client.loop_stop()
        _client.disconnect()
        _client = None
