"""Simulates a servo-controlled boom gate.

Subscribes to the "open gate" command the backend publishes after a
successful QR scan (POST /gate/scan), simulates the servo sweep with a
short delay, prints a local log line (standing in for whatever an ESP32
would print over serial / write to its own flash log), and acks back over
MQTT so the rest of the stack can observe the gate actually cycled.

Usage:
    python gate_simulator.py
"""

import json
import signal
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from config import MQTT_HOST, MQTT_KEEPALIVE, MQTT_PORT, TOPIC_GATE_ACK, TOPIC_GATE_COMMAND

GATE_OPEN_SECONDS = 2.5


def log_line(message: str) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    line = f"[{ts}] {message}"
    print(line)
    with open("gate_events.log", "a") as f:
        f.write(line + "\n")


def on_connect(client: mqtt.Client, userdata, flags, reason_code, properties=None):
    print(f"[gate-sim] connected ({reason_code}); listening on {TOPIC_GATE_COMMAND}")
    client.subscribe(TOPIC_GATE_COMMAND, qos=1)


def on_message(client: mqtt.Client, userdata, msg: mqtt.MQTTMessage):
    try:
        command = json.loads(msg.payload.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        print(f"[gate-sim] bad payload: {msg.payload!r}")
        return

    direction = command.get("direction", "entry")
    slot_index = command.get("slot_index")
    booking_id = command.get("booking_id")

    log_line(
        f"GATE COMMAND received: direction={direction} slot={slot_index} booking={booking_id}"
    )
    log_line("Servo sweeping 0deg -> 90deg (gate opening)...")
    time.sleep(GATE_OPEN_SECONDS)
    log_line(f"Gate OPEN. {'Entry' if direction == 'entry' else 'Exit'} in progress for slot {slot_index}.")
    time.sleep(GATE_OPEN_SECONDS)
    log_line("Servo sweeping 90deg -> 0deg (gate closing)...")

    ack = {
        "booking_id": booking_id,
        "slot_index": slot_index,
        "direction": direction,
        "status": "completed",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    client.publish(TOPIC_GATE_ACK, json.dumps(ack), qos=1)
    log_line(f"Gate CLOSED. Ack published to {TOPIC_GATE_ACK}.")


def run() -> None:
    client = mqtt.Client(
        client_id="hardware-sim-gate",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE)

    running = {"flag": True}

    def handle_sigint(signum, frame):
        print("\n[gate-sim] shutting down...")
        running["flag"] = False
        client.disconnect()

    signal.signal(signal.SIGINT, handle_sigint)

    client.loop_start()
    while running["flag"]:
        time.sleep(0.5)
    client.loop_stop()


if __name__ == "__main__":
    run()
