"""ParkGrid gateway -- bridges the Arduino nodes (UART line protocol) and MQTT.

This is the program a Raspberry Pi runs in a real installation: the Arduino
Unos have no network interface, so each one is plugged into the Pi by USB and
this process translates between their compact serial frames and the JSON
messages on the MQTT bus the backend listens to.

Node serial ports are given as pyserial URLs, so the identical code runs

  * on a Raspberry Pi:        GATEWAY_NODES="zone-a=/dev/ttyUSB0,zone-b=/dev/ttyUSB1,gate=/dev/ttyACM0"
  * against the hardware lab: GATEWAY_NODES="zone-a=socket://hardware-lab:7001,..."

Frames, node -> gateway                   MQTT published
  B,<node>,<fw>,<first_slot>,<slots>      parking/node/<node>/status        (retained)
  H,<node>,<uptime_s>                     parking/node/<node>/status        (retained)
  S,<slot>,<0|1>,<distance_cm>            parking/sensor/<slot>/status
  V,<0|1>                                 parking/gate/vehicle
  A,<entry|exit>,<booking>,<slot>         parking/gate/ack
  # <text>                                (logged only)

Frames, gateway -> node                   MQTT consumed
  L,<slot>,<f|b|o>                        parking/slot/<slot>/state         (retained)
  G,<entry|exit>,<booking>,<slot>         parking/gate/command  action=open
  D,<reason>                              parking/gate/command  action=deny
  F,<free>,<total>                        derived from the slot states
"""

import json
import logging
import os
import signal
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import serial

MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
BAUD = int(os.environ.get("GATEWAY_BAUD", "115200"))
REFRESH_SECONDS = float(os.environ.get("GATEWAY_REFRESH_SECONDS", "30"))
TOTAL_SLOTS = int(os.environ.get("TOTAL_SLOTS", "20"))
DEFAULT_SLOTS_PER_NODE = 4

DEFAULT_NODES = ",".join(
    [f"zone-{c}=socket://hardware-lab:{7001 + i}" for i, c in enumerate("abcde")]
    + ["gate=socket://hardware-lab:7010"]
)
NODE_SPECS = os.environ.get("GATEWAY_NODES", DEFAULT_NODES)

TOPIC_SENSOR = "parking/sensor/{slot}/status"
TOPIC_SLOT_STATE = "parking/slot/+/state"
TOPIC_GATE_COMMAND = "parking/gate/command"
TOPIC_GATE_ACK = "parking/gate/ack"
TOPIC_GATE_VEHICLE = "parking/gate/vehicle"
TOPIC_NODE_STATUS = "parking/node/{node}/status"

STATE_CODE = {"free": "f", "booked": "b", "occupied": "o"}

log = logging.getLogger("gateway")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Node:
    """One serial-attached Arduino and its reader thread."""

    def __init__(self, name: str, url: str, gateway: "Gateway"):
        self.name = name
        self.url = url
        self.gateway = gateway
        self.first_slot: int | None = None
        self.slot_count = 0
        self.firmware: str | None = None
        self.port: serial.SerialBase | None = None
        self.write_lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, name=f"node-{name}", daemon=True)

    # Slots a zone node owns: learned from its boot banner, otherwise from its name (zone-a = 1-4).
    def owns(self, slot: int) -> bool:
        first, count = self.first_slot, self.slot_count
        if first is None and self.name.startswith("zone-") and len(self.name) == 6:
            first, count = (ord(self.name[-1]) - ord("a")) * DEFAULT_SLOTS_PER_NODE + 1, DEFAULT_SLOTS_PER_NODE
        return first is not None and first <= slot < first + count

    def start(self) -> None:
        self.thread.start()

    def send(self, line: str) -> None:
        port = self.port
        if port is None:
            return
        try:
            with self.write_lock:
                port.write((line + "\n").encode("ascii", "replace"))
            log.debug("-> %s: %s", self.name, line)
        except (serial.SerialException, OSError) as exc:
            log.warning("write to %s failed: %s", self.name, exc)

    def _run(self) -> None:
        while not self.gateway.stopping.is_set():
            try:
                self.port = serial.serial_for_url(self.url, baudrate=BAUD, timeout=1)
                log.info("%s: serial link up (%s)", self.name, self.url)
                self.send("?")  # ask the node to announce itself again (we may have missed its boot banner)
            except (serial.SerialException, OSError) as exc:
                log.warning("%s: cannot open %s (%s); retrying", self.name, self.url, exc)
                time.sleep(2)
                continue

            try:
                while not self.gateway.stopping.is_set():
                    raw = self.port.readline()
                    if not raw:
                        continue
                    line = raw.decode("ascii", "replace").strip()
                    if line:
                        self.gateway.on_frame(self, line)
            except (serial.SerialException, OSError) as exc:
                log.warning("%s: serial link lost (%s)", self.name, exc)
            finally:
                try:
                    self.port.close()
                except Exception:  # noqa: BLE001
                    pass
                self.port = None
            time.sleep(1)


class Gateway:
    def __init__(self, node_specs: str):
        self.stopping = threading.Event()
        self.nodes: dict[str, Node] = {}
        for spec in filter(None, (s.strip() for s in node_specs.split(","))):
            name, _, url = spec.partition("=")
            self.nodes[name.strip()] = Node(name.strip(), url.strip(), self)

        self.slot_states: dict[int, str] = {}
        self.state_lock = threading.Lock()

        self.client = mqtt.Client(
            client_id="parkgrid-pi-gateway",
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=10)

    # ---- lifecycle -----------------------------------------------------------
    def run(self) -> None:
        log.info("connecting to MQTT %s:%s", MQTT_HOST, MQTT_PORT)
        while not self.stopping.is_set():
            try:
                self.client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
                break
            except OSError as exc:
                log.warning("MQTT broker not reachable (%s); retrying", exc)
                time.sleep(2)
        self.client.loop_start()
        for node in self.nodes.values():
            node.start()

        last_refresh = time.monotonic()
        while not self.stopping.wait(1.0):
            if time.monotonic() - last_refresh >= REFRESH_SECONDS:
                self.push_all_states()
                last_refresh = time.monotonic()

        self.client.loop_stop()
        self.client.disconnect()

    def stop(self) -> None:
        self.stopping.set()

    # ---- MQTT side -----------------------------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        log.info("MQTT connected (%s)", reason_code)
        client.subscribe(TOPIC_SLOT_STATE, qos=1)
        client.subscribe(TOPIC_GATE_COMMAND, qos=1)

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            log.warning("bad payload on %s", msg.topic)
            return

        if msg.topic == TOPIC_GATE_COMMAND:
            self._on_gate_command(payload)
            return

        parts = msg.topic.split("/")  # parking/slot/<n>/state
        if len(parts) == 4 and parts[1] == "slot" and parts[3] == "state":
            try:
                slot = int(parts[2])
            except ValueError:
                return
            status = payload.get("status")
            if status in STATE_CODE:
                with self.state_lock:
                    self.slot_states[slot] = status
                self.push_slot_state(slot)
                self.push_free_count()

    def _on_gate_command(self, command: dict) -> None:
        gate = self.nodes.get("gate")
        if gate is None:
            return
        action = command.get("action")
        if action == "open":
            direction = "exit" if command.get("direction") == "exit" else "entry"
            gate.send(f"G,{direction},{command.get('booking_id', 0)},{command.get('slot_index', 0)}")
        elif action == "deny":
            reason = str(command.get("reason", "Not allowed"))[:16].replace(",", " ")
            gate.send(f"D,{reason}")

    def publish(self, topic: str, payload: dict, retain: bool = False) -> None:
        self.client.publish(topic, json.dumps(payload), qos=1, retain=retain)

    # ---- pushing backend state down to the nodes -------------------------------------
    def push_slot_state(self, slot: int) -> None:
        with self.state_lock:
            status = self.slot_states.get(slot)
        if status is None:
            return
        for node in self.nodes.values():
            if node.owns(slot):
                node.send(f"L,{slot},{STATE_CODE[status]}")

    def push_free_count(self) -> None:
        gate = self.nodes.get("gate")
        if gate is None:
            return
        with self.state_lock:
            known = len(self.slot_states)
            free = sum(1 for s in self.slot_states.values() if s == "free")
        if known:
            gate.send(f"F,{free},{max(known, TOTAL_SLOTS)}")

    def push_all_states(self) -> None:
        with self.state_lock:
            slots = list(self.slot_states)
        for slot in slots:
            self.push_slot_state(slot)
        self.push_free_count()

    # ---- serial side -------------------------------------------------------------
    def on_frame(self, node: Node, line: str) -> None:
        log.debug("<- %s: %s", node.name, line)
        if line.startswith("#"):
            log.info("%s %s", node.name, line)
            return

        fields = line.split(",")
        kind = fields[0]
        try:
            if kind == "S" and len(fields) == 4:
                slot = int(fields[1])
                self.publish(
                    TOPIC_SENSOR.format(slot=slot),
                    {
                        "sensor_id": f"{node.name}-s{slot:02d}",
                        "node": node.name,
                        "slot_index": slot,
                        "distance_cm": float(fields[3]),
                        "occupied": fields[2] == "1",
                        "timestamp": now_iso(),
                    },
                )
            elif kind == "B" and len(fields) == 5:
                node.first_slot, node.slot_count = int(fields[3]), int(fields[4])
                node.firmware = fields[2]
                self.publish(
                    TOPIC_NODE_STATUS.format(node=node.name),
                    {
                        "node": node.name,
                        "online": True,
                        "event": "boot",
                        "firmware": fields[2],
                        "first_slot": node.first_slot,
                        "slots": node.slot_count,
                        "timestamp": now_iso(),
                    },
                    retain=True,
                )
                # The node just (re)booted and has forgotten every LED state: tell it again.
                self.push_all_states()
            elif kind == "H" and len(fields) == 3:
                self.publish(
                    TOPIC_NODE_STATUS.format(node=node.name),
                    {
                        "node": node.name,
                        "online": True,
                        "event": "heartbeat",
                        "firmware": node.firmware,
                        "first_slot": node.first_slot,
                        "slots": node.slot_count,
                        "uptime_s": int(fields[2]),
                        "timestamp": now_iso(),
                    },
                    retain=True,
                )
            elif kind == "V" and len(fields) == 2:
                self.publish(TOPIC_GATE_VEHICLE, {"present": fields[1] == "1", "timestamp": now_iso()})
            elif kind == "A" and len(fields) == 4:
                self.publish(
                    TOPIC_GATE_ACK,
                    {
                        "booking_id": int(fields[2]),
                        "slot_index": int(fields[3]),
                        "direction": fields[1],
                        "status": "completed",
                        "timestamp": now_iso(),
                    },
                )
            else:
                log.warning("%s: unrecognised frame %r", node.name, line)
        except ValueError:
            log.warning("%s: malformed frame %r", node.name, line)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    gateway = Gateway(NODE_SPECS)
    signal.signal(signal.SIGINT, lambda *_: gateway.stop())
    signal.signal(signal.SIGTERM, lambda *_: gateway.stop())
    log.info("nodes: %s", ", ".join(f"{n.name}={n.url}" for n in gateway.nodes.values()))
    gateway.run()


if __name__ == "__main__":
    main()
