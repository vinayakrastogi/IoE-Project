import { useMemo } from "react";

import { curvePoint, Part, pinPos, PowerStub, ResistorGlyph, Stage, Wires } from "./parts";

const W = 1040;
const H = 590;

// Everything hangs off the digital header, left to right: LCD, servo, IR, buzzer, lamps.
const UNO = { x: 440, y: 300 };
const LCD = { x: 20, y: 28 };
const SERVO = { x: 345, y: 70, rotate: -90 };
const IR = { x: 520, y: 100, w: 108, h: 66 };
const BUZZER = { x: 690, y: 76 };
const LED_RED = { x: 800, y: 104, props: { flip: true } };
const LED_GREEN = { x: 905, y: 104, props: { flip: true } };

const COLOR = {
  servo: "#fbbf24",
  ir: "#22d3ee",
  buzzer: "#c084fc",
  red: "#ef4444",
  green: "#22c55e",
  lcd: "#cbd5e1",
};

const uno = (pin) => pinPos("wokwi-arduino-uno", pin, UNO);
const servoPin = (pin) => pinPos("wokwi-servo", pin, SERVO);
const buzzerPin = (pin) => pinPos("wokwi-buzzer", pin, BUZZER);
const ledPin = (led, pin) => pinPos("wokwi-led", pin, led);
const lcdPin = (pin) => pinPos("wokwi-lcd1602", pin, { ...LCD, props: { pins: "full" } });

const irPin = (name) => {
  const offset = { GND: 24, VCC: 54, OUT: 84 }[name];
  return { x: IR.x + offset, y: IR.y + IR.h + 12 };
};

function lcdCharacters(lines) {
  const chars = new Array(32).fill(32);
  lines.forEach((line, row) => {
    for (let col = 0; col < 16; col++) chars[row * 16 + col] = (line.charCodeAt(col) || 32) & 0xff;
  });
  return chars;
}

function IrSensor({ blocked }) {
  const { x, y, w, h } = IR;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx="5" fill="#1d4f91" stroke="#0b2a52" strokeWidth="1.5" />
      <circle cx="26" cy="22" r="11" fill="#e2e8f0" opacity="0.92" />
      <circle cx="26" cy="22" r="6" fill="#cbd5e1" />
      <circle cx="58" cy="22" r="11" fill="#1f2937" />
      <circle cx="58" cy="22" r="6" fill="#374151" />
      <rect x="82" y="8" width="18" height="18" rx="2" fill="#2563eb" stroke="#0b2a52" />
      <circle cx="91" cy="17" r="5" fill="#e5e7eb" />
      <rect x="10" y="48" width="9" height="6" rx="1.5" fill="#22c55e" />
      <rect
        x="26"
        y="48"
        width="9"
        height="6"
        rx="1.5"
        fill={blocked ? "#ef4444" : "#4b1d1d"}
        style={blocked ? { filter: "drop-shadow(0 0 5px #ef4444)" } : undefined}
      />
      {[24, 54, 84].map((px) => (
        <rect key={px} x={px - 3} y={h - 2} width="6" height="14" fill="#cbd5e1" />
      ))}
    </g>
  );
}

const caption = "absolute font-mono text-center leading-tight";

export default function GateCircuit({ node, serialActivity }) {
  const lcdChars = useMemo(() => lcdCharacters(node.lcd), [node.lcd]);

  const wires = [];
  const resistors = [];

  // LCD bus: RS, E, D4..D7 on D13..D8
  [
    ["RS", "13"],
    ["E", "12"],
    ["D4", "11"],
    ["D5", "10"],
    ["D6", "9"],
    ["D7", "8"],
  ].forEach(([lcdName, unoPin]) => {
    wires.push({ points: [lcdPin(lcdName), uno(unoPin)], color: COLOR.lcd, width: 2, opacity: 0.85 });
  });

  wires.push({ points: [servoPin("PWM"), uno("7")], color: COLOR.servo });
  wires.push({ points: [irPin("OUT"), uno("6")], color: COLOR.ir, active: node.ir.blocked });
  wires.push({ points: [buzzerPin("1"), uno("5")], color: COLOR.buzzer, active: node.buzzer });

  const red = { from: uno("4"), to: ledPin(LED_RED, "A") };
  const green = { from: uno("3"), to: ledPin(LED_GREEN, "A") };
  wires.push({ points: [red.from, red.to], color: COLOR.red, active: node.led.red });
  wires.push({ points: [green.from, green.to], color: COLOR.green, active: node.led.green });
  resistors.push(curvePoint(red.from, red.to, 0.45), curvePoint(green.from, green.to, 0.45));

  const servoGnd = servoPin("GND");
  const servoVcc = servoPin("V+");
  const buzzerGnd = buzzerPin("2");

  return (
    <Stage width={W} height={H}>
      <Part
        tag="wokwi-lcd1602"
        x={LCD.x}
        y={LCD.y}
        props={{ pins: "full", characters: lcdChars, backlight: true, color: "#0b1a07", background: "#7ec87e" }}
      />
      <Part tag="wokwi-servo" x={SERVO.x} y={SERVO.y} rotate={SERVO.rotate} props={{ angle: node.servo.angle, horn: "single" }} />
      <Part tag="wokwi-buzzer" x={BUZZER.x} y={BUZZER.y} props={{ hasSignal: node.buzzer }} />
      <Part
        tag="wokwi-led"
        x={LED_RED.x}
        y={LED_RED.y}
        props={{ ...LED_RED.props, color: "red", value: node.led.red }}
      />
      <Part
        tag="wokwi-led"
        x={LED_GREEN.x}
        y={LED_GREEN.y}
        props={{ ...LED_GREEN.props, color: "green", value: node.led.green }}
      />
      <Part
        tag="wokwi-arduino-uno"
        x={UNO.x}
        y={UNO.y}
        props={{ ledPower: true, ledTX: serialActivity.tx, ledRX: serialActivity.rx }}
      />

      <Wires width={W} height={H} wires={wires} />

      <svg className="absolute left-0 top-0 pointer-events-none" width={W} height={H}>
        <IrSensor blocked={node.ir.blocked} />
        {resistors.map((r, i) => (
          <ResistorGlyph key={i} x={r.x} y={r.y} />
        ))}
        {/* power pins: ground / 5V symbols instead of more wires */}
        <PowerStub x={servoGnd.x} y={servoGnd.y + 1} depth={22} kind="gnd" />
        <PowerStub x={servoVcc.x} y={servoVcc.y + 1} depth={8} kind="vcc" anchor="end" />
        <PowerStub x={irPin("VCC").x} y={irPin("VCC").y + 1} kind="vcc" />
        <PowerStub x={irPin("GND").x} y={irPin("GND").y + 1} kind="gnd" />
        <PowerStub x={buzzerGnd.x} y={buzzerGnd.y + 1} kind="gnd" />
        {[LED_RED, LED_GREEN].map((led, i) => {
          const c = ledPin(led, "C");
          return <PowerStub key={i} x={c.x} y={c.y + 1} kind="gnd" />;
        })}
        <PowerStub x={lcdPin("VSS").x} y={lcdPin("VSS").y + 1} kind="gnd" />
        <PowerStub x={lcdPin("VDD").x} y={lcdPin("VDD").y + 1} kind="vcc" />
        <PowerStub x={lcdPin("A").x} y={lcdPin("A").y + 1} kind="vcc" anchor="start" />
        <PowerStub x={lcdPin("K").x} y={lcdPin("K").y + 1} kind="gnd" />
      </svg>

      {/* captions */}
      <div className={caption} style={{ left: LCD.x, top: LCD.y - 24, width: 302, fontSize: 12 }}>
        <span className="text-ink font-semibold">16x2 LCD</span> <span className="text-muted">4-bit, D13-D8</span>
      </div>
      <div className={caption} style={{ left: SERVO.x - 40, top: SERVO.y - 66, width: 210, fontSize: 12 }}>
        <span className="text-ink font-semibold">Barrier servo</span> <span className="text-muted">D7</span>
        <div className="text-amber-300">
          {node.servo.attached ? `${node.servo.angle} deg  (${node.servo.pulseUs} us pulse)` : "not attached"}
        </div>
      </div>
      <div className={caption} style={{ left: IR.x - 16, top: IR.y - 38, width: 140, fontSize: 12 }}>
        <span className="text-ink font-semibold">IR beam</span> <span className="text-muted">D6</span>
        <div className={node.ir.blocked ? "text-red-300" : "text-muted"}>{node.ir.blocked ? "vehicle present" : "clear"}</div>
      </div>
      <div className={caption} style={{ left: BUZZER.x - 20, top: BUZZER.y - 38, width: 120, fontSize: 12 }}>
        <span className="text-ink font-semibold">Buzzer</span> <span className="text-muted">D5</span>
        <div className={node.buzzer ? "text-purple-300" : "text-muted"}>{node.buzzer ? "sounding" : "silent"}</div>
      </div>
      <div className={`${caption} text-muted`} style={{ left: LED_RED.x - 30, top: LED_RED.y - 34, width: 100, fontSize: 11 }}>
        D4 stop lamp
      </div>
      <div className={`${caption} text-muted`} style={{ left: LED_GREEN.x - 30, top: LED_GREEN.y - 34, width: 100, fontSize: 11 }}>
        D3 go lamp
      </div>
      <div className={`${caption} text-muted`} style={{ left: UNO.x - 330, top: UNO.y + 110, width: 300, fontSize: 11, textAlign: "right" }}>
        gate controller
        <div>Arduino Uno, ATmega328P @ {node.clockMHz} MHz</div>
        <div className="opacity-70">LCD: RW and V0 to GND</div>
      </div>
    </Stage>
  );
}
