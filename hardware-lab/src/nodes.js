// The two kinds of Arduino node in the lot, each wrapping one emulated Uno
// that runs the compiled firmware from /firmware/build.

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import { AVRRunner } from "./avr-runner.js";
import { HCSR04 } from "./peripherals/hcsr04.js";
import { HD44780 } from "./peripherals/hd44780.js";
import { ServoMotor } from "./peripherals/servo.js";

const MAX_CATCH_UP_CYCLES = 0.25 * 16_000_000; // never try to recover more than 250 ms of lag

// Pin maps -- must match the #defines in the sketches.
export const ZONE_PINS = {
  trig: [9, 7, 5, 3],
  echo: [8, 6, 4, 2],
  green: [13, 14, 16, 18], // D13, A0, A2, A4
  red: [12, 15, 17, 19],   // D12, A1, A3, A5
};
export const SLOTS_PER_ZONE = 4;

export const GATE_PINS = {
  servo: 7,
  ir: 6,
  buzzer: 5,
  red: 4,
  green: 3,
  lcd: { rs: 13, e: 12, data: [11, 10, 9, 8] }, // D4..D7, all on PORTB
};

export const slotLabel = (slot) =>
  `${String.fromCharCode(65 + Math.floor((slot - 1) / 5))}${((slot - 1) % 5) + 1}`;

class EmulatedNode extends EventEmitter {
  constructor({ id, hexPath, world }) {
    super();
    this.id = id;
    this.hexPath = hexPath;
    this.world = world;
    this.disposers = [];
    this.timers = [0]; // which hardware timers the firmware really uses
    this.txLine = "";
    this.rxLine = "";
    this.bootCount = 0;
    this.lastStatsAt = 0;
    this.lastStats = { cycles: 0, sleepCycles: 0 };
    this.cpuBusy = 0;
  }

  boot() {
    this.shutdown();
    const hex = readFileSync(this.hexPath, "utf8");
    this.runner = new AVRRunner(hex, { timers: this.timers });
    this.runner.onSerialByte = (byte) => this.#onTxByte(byte);
    this.t0 = performance.now();
    this.bootCount++;
    this.attachPeripherals();
  }

  /** Pull the (virtual) reset button. */
  reset() {
    this.emit("serial", { dir: "info", line: "-- reset --" });
    this.boot();
  }

  attachPeripherals() {}

  onWorld(event, handler) {
    this.world.on(event, handler);
    this.disposers.push(() => this.world.off(event, handler));
  }

  shutdown() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  /** Advance the emulated CPU to match wall-clock time. */
  step(now) {
    const { runner } = this;
    const wanted = Math.floor(((now - this.t0) * runner.clockHz) / 1000);
    let lag = wanted - runner.cycles;
    if (lag > MAX_CATCH_UP_CYCLES) {
      this.t0 += ((lag - MAX_CATCH_UP_CYCLES) / runner.clockHz) * 1000; // drop time instead of spiralling
      lag = MAX_CATCH_UP_CYCLES;
    }
    if (lag > 0) runner.execute(runner.cycles + lag);

    if (now - this.lastStatsAt >= 1000) {
      const cycles = runner.cycles - this.lastStats.cycles;
      const slept = runner.sleepCycles - this.lastStats.sleepCycles;
      this.cpuBusy = cycles > 0 ? Math.max(0, 1 - slept / cycles) : 0;
      this.lastStats = { cycles: runner.cycles, sleepCycles: runner.sleepCycles };
      this.lastStatsAt = now;
    }
  }

  /** Bytes from the gateway into the node's UART RX. */
  receive(buffer) {
    this.runner.sendSerial(buffer);
    for (const byte of buffer) {
      if (byte === 10) {
        if (this.rxLine) this.emit("serial", { dir: "rx", line: this.rxLine });
        this.rxLine = "";
      } else if (byte !== 13) {
        this.rxLine += String.fromCharCode(byte);
      }
    }
  }

  #onTxByte(byte) {
    if (byte === 10) {
      const line = this.txLine;
      this.txLine = "";
      if (line) {
        this.onTxLine(line);
        this.emit("serial", { dir: "tx", line });
        this.emit("tx", Buffer.from(`${line}\n`, "latin1"));
      }
    } else if (byte !== 13 && this.txLine.length < 200) {
      this.txLine += String.fromCharCode(byte);
    }
  }

  onTxLine() {}

  baseState() {
    return {
      id: this.id,
      online: true,
      boots: this.bootCount,
      uptimeS: Math.round(this.runner.uptimeMs / 1000),
      cpuBusyPct: Math.round(this.cpuBusy * 100),
      clockMHz: this.runner.clockHz / 1e6,
    };
  }
}

export class ZoneNode extends EmulatedNode {
  constructor({ zone, hexPath, world }) {
    super({ id: `zone-${String.fromCharCode(97 + zone)}`, hexPath, world });
    this.zone = zone;
    this.firstSlot = zone * SLOTS_PER_ZONE + 1;
    this.reports = new Map(); // slot -> last S frame the firmware sent
  }

  attachPeripherals() {
    this.reports.clear();
    this.sensors = [];
    for (let i = 0; i < SLOTS_PER_ZONE; i++) {
      const slot = this.firstSlot + i;
      const sensor = new HCSR04(this.runner, {
        trigPin: ZONE_PINS.trig[i],
        echoPin: ZONE_PINS.echo[i],
        distanceCm: this.world.distanceOf(slot),
      });
      this.sensors.push(sensor);
    }
    this.onWorld("distance", (slot, cm) => {
      const index = slot - this.firstSlot;
      if (index >= 0 && index < SLOTS_PER_ZONE) this.sensors[index].distanceCm = cm;
    });
  }

  onTxLine(line) {
    const parts = line.split(",");
    if (parts[0] === "S") {
      this.reports.set(Number(parts[1]), { occupied: parts[2] === "1", distanceCm: Number(parts[3]) });
    }
  }

  state() {
    const slots = [];
    for (let i = 0; i < SLOTS_PER_ZONE; i++) {
      const slot = this.firstSlot + i;
      const report = this.reports.get(slot);
      slots.push({
        slot,
        label: slotLabel(slot),
        worldCm: Math.round(this.world.distanceOf(slot) * 10) / 10,
        measuredCm: report ? report.distanceCm : null,
        occupied: report ? report.occupied : null,
        led: {
          red: this.runner.pinLevel(ZONE_PINS.red[i]) === 1,
          green: this.runner.pinLevel(ZONE_PINS.green[i]) === 1,
        },
        pins: {
          trig: ZONE_PINS.trig[i],
          echo: ZONE_PINS.echo[i],
          red: ZONE_PINS.red[i],
          green: ZONE_PINS.green[i],
        },
      });
    }
    return { ...this.baseState(), kind: "zone", zone: this.zone, firstSlot: this.firstSlot, slots };
  }
}

export class GateNode extends EmulatedNode {
  constructor({ hexPath, world }) {
    super({ id: "gate", hexPath, world });
    this.timers = [0, 1]; // Timer1 drives the Servo library
  }

  attachPeripherals() {
    this.servo = new ServoMotor(this.runner, { pin: GATE_PINS.servo });

    const { port } = this.runner.pinRef(GATE_PINS.lcd.rs);
    const bitOf = (pin) => this.runner.pinRef(pin).bit;
    this.lcd = new HD44780(this.runner, {
      port,
      rsBit: bitOf(GATE_PINS.lcd.rs),
      eBit: bitOf(GATE_PINS.lcd.e),
      dataBits: GATE_PINS.lcd.data.map(bitOf),
    });

    const applyBeam = (blocked) => this.runner.driveInput(GATE_PINS.ir, !blocked); // module output is active LOW
    applyBeam(this.world.beamBlocked);
    this.onWorld("beam", applyBeam);
  }

  state() {
    return {
      ...this.baseState(),
      kind: "gate",
      servo: { angle: this.servo.angle, pulseUs: this.servo.pulseUs, attached: this.servo.attached },
      led: {
        green: this.runner.pinLevel(GATE_PINS.green) === 1,
        red: this.runner.pinLevel(GATE_PINS.red) === 1,
      },
      buzzer: this.runner.pinLevel(GATE_PINS.buzzer) === 1,
      ir: { blocked: this.world.beamBlocked },
      lcd: this.lcd.lines(),
      pins: GATE_PINS,
    };
  }
}
