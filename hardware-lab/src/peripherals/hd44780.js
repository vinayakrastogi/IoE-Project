// HD44780 character LCD (16x2) in 4-bit mode, as driven by Arduino's
// LiquidCrystal library with RW tied to ground. All pins live on one AVR port:
// RS = bit rsBit, E = bit eBit, D4..D7 = bits dataBits[0..3].
//
// Data is latched on the falling edge of E. After reset the controller is in
// 8-bit mode and only sees the high nibble; the library's init sequence ends
// with a 0x2 nibble that switches it to 4-bit mode.

import { PinState } from "avr8js";

const COLS = 16;
const ROWS = 2;

export class HD44780 {
  constructor(runner, { port, rsBit, eBit, dataBits }) {
    this.ddram = new Uint8Array(0x80).fill(0x20);
    this.address = 0;
    this.increment = true;
    this.displayOn = false;
    this.cursorOn = false;
    this.blinkOn = false;
    this.fourBit = false;
    this.highNibble = null;
    this.version = 0; // bumped on every visible change so callers can diff cheaply

    const eMask = 1 << eBit;
    port.addListener((value, previous) => {
      const fallingE = (previous & eMask) !== 0 && (value & eMask) === 0;
      if (!fallingE) return;
      if (port.pinState(eBit) === PinState.Input) return;
      const rs = (value >> rsBit) & 1;
      let nibble = 0; // data pins were set up before E went low
      dataBits.forEach((bit, i) => {
        nibble |= ((value >> bit) & 1) << i;
      });
      this.#latch(rs, nibble);
    });
  }

  #latch(rs, nibble) {
    if (!this.fourBit) {
      // 8-bit interface: only D7..D4 are connected, each strobe is a full instruction.
      if (rs === 0 && nibble === 0x2) this.fourBit = true; // function set: switch to 4-bit
      return;
    }
    if (this.highNibble === null) {
      this.highNibble = nibble;
      return;
    }
    const byte = (this.highNibble << 4) | nibble;
    this.highNibble = null;
    if (rs === 0) this.#command(byte);
    else this.#write(byte);
  }

  #command(c) {
    if (c === 0x01) {
      this.ddram.fill(0x20);
      this.address = 0;
      this.increment = true;
    } else if (c <= 0x03) {
      this.address = 0;
    } else if (c <= 0x07) {
      this.increment = (c & 0x02) !== 0;
    } else if (c <= 0x0f) {
      this.displayOn = (c & 0x04) !== 0;
      this.cursorOn = (c & 0x02) !== 0;
      this.blinkOn = (c & 0x01) !== 0;
    } else if (c >= 0x80) {
      this.address = c & 0x7f;
    }
    this.version++;
  }

  #write(byte) {
    this.ddram[this.address & 0x7f] = byte;
    this.address = (this.address + (this.increment ? 1 : -1)) & 0x7f;
    this.version++;
  }

  /** Visible text, one string per row. Row 2 starts at DDRAM address 0x40. */
  lines() {
    const rows = [];
    for (let row = 0; row < ROWS; row++) {
      let text = "";
      for (let col = 0; col < COLS; col++) {
        text += String.fromCharCode(this.ddram[row * 0x40 + col]);
      }
      rows.push(text);
    }
    return rows;
  }
}
