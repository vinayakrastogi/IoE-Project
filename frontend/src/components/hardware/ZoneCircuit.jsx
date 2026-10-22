import { curvePoint, GroundGlyph, Part, pinPos, ResistorGlyph, Stage, SupplyGlyph, Wires } from "./parts";

const W = 1040;
const H = 600;

const UNO = { x: 383, y: 215 };
const SENSOR_X = [70, 315, 560, 805];
const SENSOR_Y = 40;
const LED_X = [330, 520, 710, 900];
const LED_Y = 440;

// Must match the pin tables in firmware/zone_node/zone_node.ino
const TRIG = ["9", "7", "5", "3"];
const ECHO = ["8", "6", "4", "2"];
const GREEN = ["13", "A0", "A2", "A4"];
const RED = ["12", "A1", "A3", "A5"];

const COLOR = {
  trig: "#38bdf8",
  echo: "#2dd4bf",
  green: "#22c55e",
  red: "#ef4444",
};

const uno = (pin) => pinPos("wokwi-arduino-uno", pin, UNO);
const sensorPin = (i, pin) => pinPos("wokwi-hc-sr04", pin, { x: SENSOR_X[i], y: SENSOR_Y });
const ledPin = (i, pin) => pinPos("wokwi-rgb-led", pin, { x: LED_X[i], y: LED_Y, rotate: 180 });

function describe(slot) {
  if (slot.occupied === null) return "waiting for first reading";
  const gap = slot.measuredCm >= 399 ? "no echo" : `${slot.measuredCm.toFixed(1)} cm`;
  return `${slot.occupied ? "OCCUPIED" : "free"}  gap ${gap}`;
}

export default function ZoneCircuit({ node, serialActivity }) {
  const slots = node.slots;
  const wires = [];
  const resistors = [];

  slots.forEach((slot, i) => {
    const green = { from: uno(GREEN[i]), to: ledPin(i, "G") };
    const red = { from: uno(RED[i]), to: ledPin(i, "R") };
    wires.push(
      { points: [sensorPin(i, "TRIG"), uno(TRIG[i])], color: COLOR.trig },
      { points: [sensorPin(i, "ECHO"), uno(ECHO[i])], color: COLOR.echo },
      { points: [green.from, green.to], color: COLOR.green, active: slot.led.green },
      { points: [red.from, red.to], color: COLOR.red, active: slot.led.red },
    );
    // stagger the two resistors along their wires so they never sit on top of each other
    resistors.push(curvePoint(green.from, green.to, 0.4), curvePoint(red.from, red.to, 0.66));
  });

  return (
    <Stage width={W} height={H}>
      {SENSOR_X.map((x, i) => (
        <Part key={`s${i}`} tag="wokwi-hc-sr04" x={x} y={SENSOR_Y} />
      ))}

      <Part
        tag="wokwi-arduino-uno"
        x={UNO.x}
        y={UNO.y}
        props={{
          ledPower: true,
          led13: slots[0].led.green,
          ledTX: serialActivity.tx,
          ledRX: serialActivity.rx,
        }}
      />

      {LED_X.map((x, i) => (
        <Part
          key={`l${i}`}
          tag="wokwi-rgb-led"
          x={x}
          y={LED_Y}
          rotate={180}
          props={{ ledRed: slots[i].led.red ? 1 : 0, ledGreen: slots[i].led.green ? 1 : 0, ledBlue: 0 }}
        />
      ))}

      <Wires width={W} height={H} wires={wires} />

      <svg className="absolute left-0 top-0 pointer-events-none" width={W} height={H}>
        {resistors.map((r, i) => (
          <ResistorGlyph key={i} x={r.x} y={r.y} />
        ))}
        {SENSOR_X.map((_, i) => {
          const vcc = sensorPin(i, "VCC");
          const gnd = sensorPin(i, "GND");
          return (
            <g key={i}>
              <SupplyGlyph x={vcc.x} y={vcc.y + 2} anchor="end" />
              <GroundGlyph x={gnd.x} y={gnd.y + 2} />
            </g>
          );
        })}
        {LED_X.map((_, i) => {
          const com = ledPin(i, "COM");
          return <GroundGlyph key={i} x={com.x} y={com.y - 3} dir={-1} />;
        })}
      </svg>

      {slots.map((slot, i) => (
        <div key={`c${i}`}>
          <div
            className="absolute text-center font-mono leading-tight"
            style={{ left: SENSOR_X[i] - 10, top: 6, width: 190, fontSize: 12 }}
          >
            <span className="text-ink font-semibold">Bay {slot.label}</span>
            <div className={slot.occupied ? "text-red-300" : "text-emerald-300"}>{describe(slot)}</div>
          </div>
          <div
            className="absolute text-center font-mono text-muted leading-tight"
            style={{ left: LED_X[i] - 39, top: LED_Y + 78, width: 120, fontSize: 11 }}
          >
            LED {slot.label}
            <div className="text-[10px] opacity-70">
              G:{GREEN[i]} R:{RED[i]}
            </div>
          </div>
        </div>
      ))}

      <div
        className="absolute font-mono text-muted leading-tight"
        style={{ left: UNO.x - 330, top: UNO.y + 110, width: 300, fontSize: 11, textAlign: "right" }}
      >
        {node.id}
        <div>Arduino Uno, ATmega328P @ {node.clockMHz} MHz</div>
      </div>
    </Stage>
  );
}
