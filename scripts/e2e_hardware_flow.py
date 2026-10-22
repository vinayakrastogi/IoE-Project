#!/usr/bin/env python3
"""End-to-end check of the whole IoT chain against a running stack.

    docker compose up -d
    python3 scripts/e2e_hardware_flow.py

It drives the system the way a user would (REST for bookings and QR scans, the
lab's WebSocket for the physical world) and checks what happens at every hop:
the Arduino pin states and LCD, the gateway, MQTT, the backend and the database.
Standard library only. Exit status 0 means every check passed.
"""

import argparse
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--api", default="http://localhost:8000")
parser.add_argument("--lab", default="http://localhost:8090")
parser.add_argument("--admin-token", default="123456789")
args = parser.parse_args()

failures = 0


def call(method, url, body=None, headers=None):
    request = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"null")


def lab_state():
    return call("GET", f"{args.lab}/api/state")[1]


def lab_send(message):
    """Send one control message to the lab's WebSocket (what the dashboard does)."""
    host, port = args.lab.replace("http://", "").split(":")
    sock = socket.create_connection((host, int(port)), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        (
            f"GET /ws HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode()
    )
    sock.recv(65536)
    payload = json.dumps(message).encode()
    mask = os.urandom(4)
    header = bytes([0x81, 0x80 | len(payload)]) if len(payload) < 126 else bytes([0x81, 0xFE]) + struct.pack(">H", len(payload))
    sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
    time.sleep(0.1)
    sock.close()


def bay(slot):
    for node in lab_state()["nodes"]:
        if node["kind"] == "zone":
            for entry in node["slots"]:
                if entry["slot"] == slot:
                    return entry


def led(slot):
    pins = bay(slot)["led"]
    if pins["red"] and pins["green"]:
        return "yellow"
    return "red" if pins["red"] else "green" if pins["green"] else "off"


def gate():
    return next(node for node in lab_state()["nodes"] if node["kind"] == "gate")


def db_status(slot):
    slots = call("GET", f"{args.api}/slots/live")[1]["slots"]
    return next(s for s in slots if s["index"] == slot)["status"]


def wait_for(condition, timeout=20.0):
    started = time.time()
    while time.time() - started < timeout:
        value = condition()
        if value:
            return time.time() - started
        time.sleep(0.2)
    return None


def check(label, condition, timeout=20.0):
    global failures
    elapsed = wait_for(condition, timeout)
    if elapsed is None:
        failures += 1
        print(f"  FAIL  {label}")
    else:
        print(f"  ok    {label}  ({elapsed:.1f} s)")
    return elapsed is not None


def expect(label, condition, detail=""):
    global failures
    if condition:
        print(f"  ok    {label}")
    else:
        failures += 1
        print(f"  FAIL  {label} {detail}")


admin = {"X-Admin-Token": args.admin_token}
call("POST", f"{args.api}/admin/slots/reset-all", headers=admin)
time.sleep(4)

print("1. A guest books a bay")
status, booking = call("POST", f"{args.api}/bookings/guest", {"guest_name": "E2E Tester", "guest_phone": "5550100", "duration_minutes": 60})
slots = call("GET", f"{args.api}/slots/live")[1]["slots"]
slot = next(s for s in slots if s["id"] == booking["slot_id"])["index"]
token = booking["qr_token"]
print(f"      booking #{booking['id']} -> slot {slot}")
check("backend marks the slot booked", lambda: db_status(slot) == "booked")
check("the bay's physical LED shows yellow", lambda: led(slot) == "yellow")

print("2. The driver scans the QR at the gate (entry)")
status, response = call("POST", f"{args.api}/gate/scan", {"qr_token": token})
expect("backend accepts the scan", status == 200 and response["action"] == "entry", f"-> {status}")
check("the barrier arm rises to 90 degrees", lambda: gate()["servo"]["angle"] >= 88)
expect("the LCD greets the driver with the slot", "Welcome" in gate()["lcd"][0])
check("the bay LED turns red", lambda: led(slot) == "red")
check("the ultrasonic sensor sees the car arrive (< 30 cm)", lambda: bay(slot)["occupied"] is True)
check("the barrier comes back down", lambda: gate()["servo"]["angle"] <= 2, 30)
time.sleep(2)
expect("the slot stays occupied after the car settles", db_status(slot) == "occupied")

print("3. The driver scans again (exit)")
status, response = call("POST", f"{args.api}/gate/scan", {"qr_token": token})
expect("backend accepts the scan as an exit", status == 200 and response["action"] == "exit", f"-> {status}")
check("backend frees the slot", lambda: db_status(slot) == "free")
check("the bay LED turns green", lambda: led(slot) == "green")
check("the sensor sees the car leave", lambda: bay(slot)["occupied"] is False)
check("the gate is idle again", lambda: "Goodbye" not in gate()["lcd"][0], 30)

print("4. Bad QR codes are rejected, loudly")
status, _ = call("POST", f"{args.api}/gate/scan", {"qr_token": token})
expect("a used QR is refused (409)", status == 409, f"-> {status}")
check("the LCD says access denied", lambda: "denied" in gate()["lcd"][0].lower(), 5)
check("the gate settles again", lambda: "denied" not in gate()["lcd"][0].lower(), 10)
status, _ = call("POST", f"{args.api}/gate/scan", {"qr_token": "forged"})
expect("a forged QR is refused (400)", status == 400, f"-> {status}")

print("5. A car parks without a booking, then an operator clears the lot")
time.sleep(5)
call("POST", f"{args.api}/admin/slots/reset-all", headers=admin)
time.sleep(3)
walk_in = 12
lab_send({"type": "distance", "slot": walk_in, "cm": 12})
check("the sensor alone makes the backend mark the slot occupied", lambda: db_status(walk_in) == "occupied")
check("its LED turns red", lambda: led(walk_in) == "red")
call("POST", f"{args.api}/admin/slots/reset-all", headers=admin)
check("the virtual car is moved out of the bay", lambda: bay(walk_in)["occupied"] is False)
time.sleep(5)
expect("the slot stays free (the sensor no longer sees a car)", db_status(walk_in) == "free" and led(walk_in) == "green")

print("6. A controller is power-cycled while a bay is booked")
status, booking = call("POST", f"{args.api}/bookings/guest", {"guest_name": "Reboot Test", "guest_phone": "5550101", "duration_minutes": 30})
booked_slot = next(s for s in call("GET", f"{args.api}/slots/live")[1]["slots"] if s["id"] == booking["slot_id"])["index"]
check("LED yellow before the reset", lambda: led(booked_slot) == "yellow")
node_id = next(n["id"] for n in lab_state()["nodes"] if n["kind"] == "zone" and any(s["slot"] == booked_slot for s in n["slots"]))
boots = next(n["boots"] for n in lab_state()["nodes"] if n["id"] == node_id)
lab_send({"type": "reset", "node": node_id})
check("the node reboots", lambda: next(n["boots"] for n in lab_state()["nodes"] if n["id"] == node_id) == boots + 1, 5)
time.sleep(1.5)  # the lamp test (all LEDs on for 0.5 s) must not be mistaken for the restored state
check("after reboot the gateway re-sends the LED state (yellow again)", lambda: led(booked_slot) == "yellow", 15)

call("POST", f"{args.api}/admin/slots/reset-all", headers=admin)
print()
print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
sys.exit(1 if failures else 0)
