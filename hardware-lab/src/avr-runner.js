// One emulated Arduino Uno (ATmega328P @ 16 MHz) built on avr8js, the same
// instruction-accurate AVR core that powers Wokwi. It runs the *real* machine
// code produced by avr-gcc; nothing here knows what the firmware does.
//
// Peripherals wired up: GPIO ports B/C/D, Timer0/1/2 (millis(), Servo, tone()),
// USART0 (Serial). Everything else a sketch might touch is left unmodelled.

import {
  CPU,
  avrInstruction,
  AVRTimer,
  timer0Config,
  timer1Config,
  timer2Config,
  AVRIOPort,
  portBConfig,
  portCConfig,
  portDConfig,
  PinState,
  AVRUSART,
  usart0Config,
} from "avr8js";

import { coarsenTimerScheduling } from "./avr-timer-fast.js";
import { parseIntelHex } from "./hex.js";

export const CLOCK_HZ = 16_000_000;

const SLEEP_OPCODE = 0x9588;
const UCSR0A = 0xc0;
const UCSR0A_RXC = 0x80;

export class AVRRunner {
  /**
   * `timers` lists which of Timer0/1/2 to instantiate. The Arduino core
   * configures all three at start-up, but a sketch that never calls
   * analogWrite()/tone()/Servo only needs Timer0 (millis()); leaving the others
   * out saves host CPU and changes nothing the firmware can observe.
   */
  constructor(hexText, { clockHz = CLOCK_HZ, timers = [0, 1, 2] } = {}) {
    this.clockHz = clockHz;
    this.cyclesPerUs = clockHz / 1e6;

    const flash = parseIntelHex(hexText);
    this.program = new Uint16Array(flash.length / 2);
    new Uint8Array(this.program.buffer).set(flash);

    const cpu = (this.cpu = new CPU(this.program));
    const timerConfigs = [timer0Config, timer1Config, timer2Config];
    this.timers = timers.map((n) => new AVRTimer(cpu, timerConfigs[n]));
    for (const timer of this.timers) coarsenTimerScheduling(timer);
    this.portB = new AVRIOPort(cpu, portBConfig);
    this.portC = new AVRIOPort(cpu, portCConfig);
    this.portD = new AVRIOPort(cpu, portDConfig);
    this.usart = new AVRUSART(cpu, usart0Config, clockHz);

    this.sleepCycles = 0; // cycles skipped while the firmware was in SLEEP
    this.onSerialByte = null;
    this.rxQueue = [];
    this.rxPumpScheduled = false;

    this.usart.onByteTransmit = (byte) => this.onSerialByte?.(byte);
    this.usart.onRxComplete = () => this.pumpRx();
  }

  // ---- pins -------------------------------------------------------------
  // Arduino Uno numbering: D0-D7 = PORTD, D8-D13 = PORTB, A0-A5 (14-19) = PORTC.
  pinRef(arduinoPin) {
    if (arduinoPin <= 7) return { port: this.portD, bit: arduinoPin };
    if (arduinoPin <= 13) return { port: this.portB, bit: arduinoPin - 8 };
    if (arduinoPin <= 19) return { port: this.portC, bit: arduinoPin - 14 };
    throw new Error(`no such Arduino pin: ${arduinoPin}`);
  }

  /** 1 if the MCU is driving the pin high, 0 if low or not an output. */
  pinLevel(arduinoPin) {
    const { port, bit } = this.pinRef(arduinoPin);
    return port.pinState(bit) === PinState.High ? 1 : 0;
  }

  /** Drive an input pin from the outside world (sensor output, button...). */
  driveInput(arduinoPin, high) {
    const { port, bit } = this.pinRef(arduinoPin);
    port.setPin(bit, high);
  }

  // ---- serial -----------------------------------------------------------
  /** Queue bytes for the MCU's UART receiver (delivered at the baud rate). */
  sendSerial(data) {
    const bytes = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    for (const byte of bytes) this.rxQueue.push(byte);
    this.pumpRx();
  }

  pumpRx() {
    if (this.rxQueue.length === 0 || this.usart.rxBusy || !this.usart.rxEnable) return;
    // Don't overrun the one-byte receive register: wait until the firmware has read the last byte.
    if (this.cpu.data[UCSR0A] & UCSR0A_RXC) {
      this.schedulePump();
      return;
    }
    if (this.usart.writeByte(this.rxQueue[0])) this.rxQueue.shift();
  }

  schedulePump() {
    if (this.rxPumpScheduled) return;
    this.rxPumpScheduled = true;
    this.cpu.addClockEvent(() => {
      this.rxPumpScheduled = false;
      this.pumpRx();
    }, 400);
  }

  // ---- execution --------------------------------------------------------
  /**
   * Run until the CPU's cycle counter reaches `untilCycles`. When the
   * firmware executes SLEEP, skip straight to the next scheduled hardware
   * event instead of burning host CPU on an idle core -- exactly what the
   * silicon does, and the reason a sleeping node costs almost nothing.
   */
  execute(untilCycles) {
    const { cpu, program } = this;
    while (cpu.cycles < untilCycles) {
      if (program[cpu.pc] === SLEEP_OPCODE) {
        cpu.pc++;
        cpu.cycles++;
        const next = cpu.nextClockEvent;
        if (next && next.cycles > cpu.cycles) {
          this.sleepCycles += next.cycles - cpu.cycles;
          cpu.cycles = next.cycles;
        }
        cpu.tick();
        continue;
      }
      avrInstruction(cpu);
      cpu.tick();
    }
  }

  get cycles() {
    return this.cpu.cycles;
  }

  get uptimeMs() {
    return (this.cpu.cycles / this.clockHz) * 1000;
  }
}
