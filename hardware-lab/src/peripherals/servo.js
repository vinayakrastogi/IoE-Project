// Hobby servo (SG90 class). Measures the width of the control pulses the
// Arduino Servo library generates on a pin and converts them to a horn angle:
// 544 us = 0 degrees, 2400 us = 180 degrees (the library's defaults).

import { PinState } from "avr8js";

const MIN_PULSE_US = 544;
const MAX_PULSE_US = 2400;

export class ServoMotor {
  constructor(runner, { pin }) {
    this.pin = pin;
    this.angle = 0;
    this.attached = false;
    this.pulseUs = 0;

    const ref = runner.pinRef(pin);
    const mask = 1 << ref.bit;
    let risenAt = null;

    ref.port.addListener((value, previous) => {
      if (((value ^ previous) & mask) === 0) return;
      if (ref.port.pinState(ref.bit) === PinState.Input) return;
      const high = (value & mask) !== 0;
      if (high) {
        risenAt = runner.cpu.cycles;
      } else if (risenAt !== null) {
        const widthUs = (runner.cpu.cycles - risenAt) / runner.cyclesPerUs;
        risenAt = null;
        if (widthUs >= 400 && widthUs <= 2700) {
          this.attached = true;
          this.pulseUs = Math.round(widthUs);
          const degrees = ((widthUs - MIN_PULSE_US) * 180) / (MAX_PULSE_US - MIN_PULSE_US);
          this.angle = Math.max(0, Math.min(180, Math.round(degrees)));
        }
      }
    });
  }
}
