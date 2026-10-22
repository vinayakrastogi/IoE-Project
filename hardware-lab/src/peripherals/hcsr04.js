// HC-SR04 ultrasonic ranger.
//
// Behaves like the real module: a >= 10 us pulse on TRIG makes it fire an
// 8-cycle 40 kHz burst, then ECHO goes high for the round-trip time of the
// sound (58 us per cm of distance). With nothing in range the module holds
// ECHO high for ~38 ms. Timing is done in CPU cycles, so the firmware's own
// pulseIn() measures exactly what it would on silicon.

import { PinState } from "avr8js";

const MIN_TRIG_US = 8;
const BURST_AND_LATENCY_US = 450;
const US_PER_CM = 58.3;
const NO_ECHO_US = 38_000;
const MAX_RANGE_CM = 400;
const MIN_RANGE_CM = 2;

export class HCSR04 {
  constructor(runner, { trigPin, echoPin, distanceCm = 200 }) {
    this.runner = runner;
    this.trigPin = trigPin;
    this.echoPin = echoPin;
    this.distanceCm = distanceCm; // set by the world model
    this.measuring = false;
    this.lastEchoUs = 0;

    const trig = runner.pinRef(trigPin);
    this.echo = runner.pinRef(echoPin);
    this.echo.port.setPin(this.echo.bit, false);

    let risenAt = null;
    const mask = 1 << trig.bit;
    trig.port.addListener((value, previous) => {
      if (((value ^ previous) & mask) === 0) return;
      if (trig.port.pinState(trig.bit) === PinState.Input) return; // still floating during boot
      const high = (value & mask) !== 0;
      if (high) {
        risenAt = runner.cpu.cycles;
      } else if (risenAt !== null) {
        const widthUs = (runner.cpu.cycles - risenAt) / runner.cyclesPerUs;
        risenAt = null;
        if (widthUs >= MIN_TRIG_US) this.#fire();
      }
    });
  }

  #fire() {
    if (this.measuring) return; // module ignores triggers while a cycle is running
    this.measuring = true;
    const { cpu, cyclesPerUs } = this.runner;

    cpu.addClockEvent(() => {
      const echoUs = this.#echoDurationUs();
      this.lastEchoUs = echoUs;
      this.echo.port.setPin(this.echo.bit, true);
      cpu.addClockEvent(() => {
        this.echo.port.setPin(this.echo.bit, false);
        this.measuring = false;
      }, Math.round(echoUs * cyclesPerUs));
    }, Math.round(BURST_AND_LATENCY_US * cyclesPerUs));
  }

  #echoDurationUs() {
    const cm = this.distanceCm;
    if (cm == null || cm > MAX_RANGE_CM || cm < MIN_RANGE_CM) return NO_ECHO_US;
    const noise = (Math.random() - 0.5) * 0.3; // +/- 0.15 cm of measurement jitter
    return Math.max(100, (cm + noise) * US_PER_CM);
  }
}
