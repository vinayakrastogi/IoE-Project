// Minimal Intel HEX loader for the ATmega328P's 32 KB flash.

export const FLASH_BYTES = 0x8000;

export function parseIntelHex(text) {
  const flash = new Uint8Array(FLASH_BYTES).fill(0xff);
  let base = 0;
  let sawEof = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line[0] !== ":") throw new Error(`bad HEX record: ${line.slice(0, 20)}`);

    const bytes = [];
    for (let i = 1; i + 1 < line.length; i += 2) bytes.push(parseInt(line.slice(i, i + 2), 16));
    const [len, addrHi, addrLo, type] = bytes;
    const checksum = bytes.reduce((sum, b) => (sum + b) & 0xff, 0);
    if (checksum !== 0) throw new Error(`HEX checksum mismatch: ${line.slice(0, 20)}`);

    if (type === 0x00) {
      const start = base + ((addrHi << 8) | addrLo);
      if (start + len > FLASH_BYTES) throw new Error("HEX image does not fit in 32 KB flash");
      for (let i = 0; i < len; i++) flash[start + i] = bytes[4 + i];
    } else if (type === 0x01) {
      sawEof = true;
      break;
    } else if (type === 0x02) {
      base = ((bytes[4] << 8) | bytes[5]) << 4;
    } else if (type === 0x04) {
      base = ((bytes[4] << 8) | bytes[5]) << 16;
    }
  }

  if (!sawEof) throw new Error("HEX file has no end-of-file record");
  return flash;
}
