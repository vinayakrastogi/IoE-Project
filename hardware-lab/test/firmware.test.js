// Runs the real compiled firmware (firmware/build/*.hex) in the emulator and
// checks its behaviour from the outside, the way the gateway and the world
// would: sensor distances in, UART frames and pin states out.
//
// Time is simulated (the node is stepped with a fake clock), so the whole file
// runs in a couple of seconds instead of real time.

import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { GateNode, ZONE_PINS, ZoneNode } from "../src/nodes.js";
import { World } from "../src/world.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const build = (name) => path.resolve(here, "../../firmware/build", `${name}.hex`);

function harness(node) {
  const lines = [];
  node.on("serial", (event) => lines.push(event));
  node.boot();
  node.t0 = 0;
  let clock = 0;
  return {
    lines,
    /** advance simulated time */
    run(ms) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + 50);
        node.step(clock);
      }
    },
    sent(prefix) {
      return lines.filter((l) => l.dir === "tx" && l.line.startsWith(prefix)).map((l) => l.line);
    },
    feed(text) {
      node.receive(Buffer.from(text, "latin1"));
    },
  };
}

describe("zone controller firmware", () => {
  const world = new World();
  after(() => world.dispose());

  const zone = new ZoneNode({ zone: 1, world, hexPath: build("zone_b") }); // slots 5-8
  const t = harness(zone);

  it("announces itself on boot with its slot range", () => {
    t.run(1500);
    assert.deepEqual(t.sent("B,"), ["B,zone-b,1.0.0,5,4"]);
  });

  it("reports every bay as free when nothing is in front of the sensors", () => {
    t.run(1500);
    for (const slot of [5, 6, 7, 8]) {
      const report = t.sent(`S,${slot},`).at(-1);
      assert.ok(report, `no report for slot ${slot}`);
      assert.match(report, new RegExp(`^S,${slot},0,`));
    }
  });

  it("measures a car with the ultrasonic sensor and reports the bay occupied", () => {
    world.setDistance(6, 14);
    t.run(2500);
    const report = t.sent("S,6,").at(-1);
    assert.match(report, /^S,6,1,/);
    const gap = Number(report.split(",")[3]);
    assert.ok(Math.abs(gap - 14) < 1.5, `measured ${gap} cm for a 14 cm gap`);
  });

  it("debounces: a car that is there for one sweep only does not flip the bay", () => {
    world.setDistance(7, 12);
    t.run(120);
    world.setDistance(7, 200);
    t.run(2000);
    assert.ok(t.sent("S,7,").every((line) => line.startsWith("S,7,0,")));
  });

  it("uses a hysteresis band: 35 cm keeps an occupied bay occupied", () => {
    world.setDistance(8, 12);
    t.run(2000);
    assert.match(t.sent("S,8,").at(-1), /^S,8,1,/);
    world.setDistance(8, 35);
    t.run(2000);
    assert.match(t.sent("S,8,").at(-1), /^S,8,1,/);
    world.setDistance(8, 60);
    t.run(2000);
    assert.match(t.sent("S,8,").at(-1), /^S,8,0,/);
  });

  it("drives the LEDs from the backend's slot state: free green, booked yellow, occupied red", () => {
    const led = (slot) => {
      const i = slot - 5;
      return [zone.runner.pinLevel(ZONE_PINS.red[i]), zone.runner.pinLevel(ZONE_PINS.green[i])];
    };
    t.feed("L,5,f\nL,6,b\nL,7,o\n");
    t.run(400);
    assert.deepEqual(led(5), [0, 1], "free is green");
    assert.deepEqual(led(6), [1, 1], "booked is red+green = yellow");
    assert.deepEqual(led(7), [1, 0], "occupied is red");
  });

  it("falls back to its own sensor when the backend has never spoken", () => {
    const standalone = new ZoneNode({ zone: 4, world, hexPath: build("zone_e") }); // slots 17-20
    const s = harness(standalone);
    world.setDistance(18, 10);
    s.run(2500);
    const i = 18 - 17;
    assert.deepEqual([standalone.runner.pinLevel(ZONE_PINS.red[i]), standalone.runner.pinLevel(ZONE_PINS.green[i])], [1, 0]);
    standalone.shutdown();
  });

  it("sleeps between sweeps instead of spinning the CPU", () => {
    t.run(3000);
    assert.ok(zone.cpuBusy < 0.05, `CPU busy ${(zone.cpuBusy * 100).toFixed(0)}%`);
  });

  after(() => zone.shutdown());
});

describe("gate controller firmware", () => {
  const world = new World();
  world.setVehicleWaiting(false);
  after(() => world.dispose());

  const gate = new GateNode({ world, hexPath: build("gate") });
  const t = harness(gate);

  it("boots with the barrier down, red lamp on and a welcome screen", () => {
    t.run(1500);
    assert.deepEqual(t.sent("B,"), ["B,gate,1.0.0,0,0"]);
    const state = gate.state();
    assert.equal(state.servo.angle, 0);
    assert.equal(state.led.red, true);
    assert.equal(state.led.green, false);
    assert.match(state.lcd[0], /ParkGrid/);
  });

  it("shows the free-slot count sent by the gateway", () => {
    t.feed("F,14,20\n");
    t.run(300);
    assert.match(gate.state().lcd[1], /Free 14 of 20/);
  });

  it("opens the barrier for an entry, shows the slot, then closes and acknowledges", () => {
    t.feed("G,entry,12,8\n");
    t.run(1500);
    let state = gate.state();
    assert.equal(state.servo.angle, 90);
    assert.equal(state.led.green, true);
    assert.equal(state.led.red, false);
    assert.match(state.lcd[0], /Welcome/);
    assert.match(state.lcd[1], /slot B3/); // slot 8 = B3

    t.run(6000);
    state = gate.state();
    assert.equal(state.servo.angle, 0);
    assert.equal(state.led.red, true);
    assert.deepEqual(t.sent("A,"), ["A,entry,12,8"]);
  });

  it("does not lower the arm while a vehicle is in the beam", () => {
    t.feed("G,exit,13,8\n");
    world.setVehicleWaiting(true); // car sitting under the arm
    t.run(8000);
    assert.equal(gate.state().servo.angle, 90, "arm stays up over a vehicle");
    assert.equal(t.sent("A,").length, 1, "no ack while the beam is blocked");

    world.setVehicleWaiting(false);
    t.run(4000);
    assert.equal(gate.state().servo.angle, 0);
    assert.deepEqual(t.sent("A,").at(-1), "A,exit,13,8");
  });

  it("rejects with a message and keeps the barrier shut", () => {
    t.feed("D,Invalid QR code\n");
    t.run(1000);
    const state = gate.state();
    assert.equal(state.servo.angle, 0);
    assert.match(state.lcd[0], /Access denied/);
    assert.match(state.lcd[1], /Invalid QR code/);
  });

  it("reports the vehicle sensor", () => {
    t.run(5000);
    world.setVehicleWaiting(true);
    t.run(600);
    assert.equal(t.sent("V,").at(-1), "V,1");
    assert.match(gate.state().lcd[0], /Show QR code/);
  });

  after(() => gate.shutdown());
});
