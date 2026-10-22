"""Simulates an ESP32 + per-slot HC-SR04 ultrasonic sensor array.

Instead of real Wokwi hardware, this drives a simulated clock (which can run
faster than real time via --speed) through a realistic diurnal occupancy
curve and publishes MQTT sensor telemetry exactly as real firmware would:
one message per slot per tick, with a raw distance reading plus the
threshold-derived boolean the ESP32 itself would compute. The rest of the
stack (backend MQTT worker, ML training data) is agnostic to whether this or
real hardware produced the message.

Usage:
    python sensor_simulator.py                       # 60x speed, from current hour
    python sensor_simulator.py --speed 360            # a full day in ~4 minutes
    python sensor_simulator.py --start-hour 7 --speed 120
"""

import argparse
import json
import random
import signal
import threading
import time
from datetime import datetime, timedelta, timezone

import paho.mqtt.client as mqtt

from config import (
    MQTT_HOST,
    MQTT_KEEPALIVE,
    MQTT_PORT,
    OCCUPIED_DISTANCE_THRESHOLD_CM,
    TOPIC_GATE_COMMAND,
    TOPIC_SENSOR_PREFIX,
    TOTAL_SLOTS,
)

# Target lot-wide occupancy % by hour of day -- shaped after the diurnal
# commuter pattern seen in the UCI Birmingham dataset (see ml/notebooks),
# pushed up around midday so the demo actually crosses the 85% peak
# threshold and triggers the ML alert.
HOURLY_TARGET_OCCUPANCY_PCT = {
    0: 8, 1: 5, 2: 4, 3: 3, 4: 4, 5: 6,
    6: 12, 7: 25, 8: 40, 9: 58, 10: 72, 11: 85,
    12: 92, 13: 90, 14: 84, 15: 76, 16: 68, 17: 55,
    18: 40, 19: 28, 20: 20, 21: 15, 22: 12, 23: 10,
}

TRANSITION_RATE = 0.15


def target_occupancy_fraction(sim_time: datetime) -> float:
    hour = sim_time.hour
    next_hour = (hour + 1) % 24
    minute_frac = sim_time.minute / 60
    current = HOURLY_TARGET_OCCUPANCY_PCT[hour]
    upcoming = HOURLY_TARGET_OCCUPANCY_PCT[next_hour]
    return (current + (upcoming - current) * minute_frac) / 100


class SlotState:
    """held=True means a real booking has this slot under active gate
    control (between a scanned entry and exit) -- the ambient random walk
    must not touch it, or it would immediately contradict/undo the gate
    scan the instant the next tick runs."""

    def __init__(self, index: int):
        self.index = index
        self.occupied = random.random() < 0.05
        self.held = False

    def step(self, target_fraction: float) -> None:
        if self.held:
            return
        if self.occupied:
            leave_prob = (1 - target_fraction) * TRANSITION_RATE
            if random.random() < leave_prob:
                self.occupied = False
        else:
            arrive_prob = target_fraction * TRANSITION_RATE
            if random.random() < arrive_prob:
                self.occupied = True

    def apply_gate_event(self, direction: str) -> None:
        self.occupied = direction == "entry"
        self.held = direction == "entry"

    def simulated_distance_cm(self) -> float:
        if self.occupied:
            return round(random.uniform(3.0, OCCUPIED_DISTANCE_THRESHOLD_CM - 2), 1)
        return round(random.uniform(OCCUPIED_DISTANCE_THRESHOLD_CM + 10, 400.0), 1)


def build_client(slots_by_index: dict[int, SlotState], lock: threading.Lock) -> mqtt.Client:
    def on_connect(client: mqtt.Client, userdata, flags, reason_code, properties=None):
        client.subscribe(TOPIC_GATE_COMMAND, qos=1)

    def on_message(client: mqtt.Client, userdata, msg: mqtt.MQTTMessage):
        try:
            command = json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return
        slot = slots_by_index.get(command.get("slot_index"))
        if slot is None:
            return
        with lock:
            slot.apply_gate_event(command.get("direction", "entry"))

    client = mqtt.Client(
        client_id="hardware-sim-sensors",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE)
    client.loop_start()
    return client


def run(speed: float, start_hour: int | None, publish_interval: float) -> None:
    slots = [SlotState(i) for i in range(1, TOTAL_SLOTS + 1)]
    slots_by_index = {s.index: s for s in slots}
    lock = threading.Lock()
    client = build_client(slots_by_index, lock)

    sim_time = datetime.now(timezone.utc)
    if start_hour is not None:
        sim_time = sim_time.replace(hour=start_hour % 24, minute=0, second=0, microsecond=0)

    print(
        f"[sensor-sim] {TOTAL_SLOTS} slots, starting sim_time={sim_time.isoformat()}, "
        f"speed={speed}x, publishing every {publish_interval}s"
    )

    running = {"flag": True}

    def handle_sigint(signum, frame):
        print("\n[sensor-sim] shutting down...")
        running["flag"] = False

    signal.signal(signal.SIGINT, handle_sigint)

    last_tick = time.monotonic()
    try:
        while running["flag"]:
            loop_start = time.monotonic()
            elapsed_real = loop_start - last_tick
            last_tick = loop_start
            sim_time = sim_time + timedelta(seconds=elapsed_real * speed)

            target_fraction = target_occupancy_fraction(sim_time)

            for slot in slots:
                with lock:
                    slot.step(target_fraction)
                payload = {
                    "sensor_id": f"esp32-{slot.index:02d}",
                    "slot_index": slot.index,
                    "distance_cm": slot.simulated_distance_cm(),
                    "occupied": slot.occupied,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "sim_time": sim_time.isoformat(),
                }
                topic = f"{TOPIC_SENSOR_PREFIX}/{slot.index}/status"
                client.publish(topic, json.dumps(payload), qos=1)

            occupied_count = sum(1 for s in slots if s.occupied)
            print(
                f"[sensor-sim] sim_time={sim_time.strftime('%a %H:%M')} "
                f"target={target_fraction * 100:4.0f}% "
                f"actual={occupied_count}/{len(slots)} ({occupied_count / len(slots) * 100:.0f}%)"
            )

            elapsed = time.monotonic() - loop_start
            time.sleep(max(0.0, publish_interval - elapsed))
    finally:
        client.loop_stop()
        client.disconnect()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Simulate ESP32 + HC-SR04 parking sensors publishing over MQTT"
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=60.0,
        help="Simulated seconds per real second (default: 60x -> 1 real minute = 1 sim hour)",
    )
    parser.add_argument(
        "--start-hour",
        type=int,
        default=None,
        help="Simulated starting hour 0-23 (default: current wall-clock hour)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=5.0,
        help="Real seconds between publish ticks (default: 5s)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(speed=args.speed, start_hour=args.start_hour, publish_interval=args.interval)
