import { useMemo } from "react";

import { Part } from "./parts";

function lcdCharacters(lines) {
  const chars = new Array(32).fill(32);
  lines.forEach((line, row) => {
    for (let col = 0; col < 16; col++) chars[row * 16 + col] = (line.charCodeAt(col) || 32) & 0xff;
  });
  return chars;
}

/** Side view of the boom barrier: 0 degrees = lying across the lane, 90 = vertical. */
function Barrier({ angle }) {
  return (
    <svg viewBox="0 0 220 110" className="w-full max-w-[260px]">
      <rect x="0" y="96" width="220" height="6" rx="3" fill="#232c40" />
      <rect x="22" y="58" width="22" height="40" rx="3" fill="#2e3a55" stroke="#3b4a6b" />
      <circle cx="33" cy="66" r="4" fill="#0e1420" />
      <g
        style={{
          transform: `rotate(${-angle}deg)`,
          transformOrigin: "33px 66px",
          transformBox: "view-box",
          transition: "transform 0.25s linear",
        }}
      >
        <rect x="33" y="62" width="170" height="8" rx="4" fill="#f8fafc" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={52 + i * 30} y="62" width="14" height="8" fill="#ef4444" />
        ))}
      </g>
    </svg>
  );
}

export default function GatePanel({ gate, world, send }) {
  const characters = useMemo(() => lcdCharacters(gate.lcd), [gate.lcd]);

  return (
    <div className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">Gate controller</h2>
        <span className="text-[11px] text-muted">Arduino Uno + servo, IR beam, LCD, buzzer</span>
      </div>

      <div className="rounded-lg overflow-hidden self-start">
        <Part
          inline
          tag="wokwi-lcd1602"
          props={{ pins: "none", characters, backlight: true, color: "#0b1a07", background: "#7ec87e" }}
        />
      </div>

      <div className="flex items-center gap-4">
        <Barrier angle={gate.servo.angle} />
        <div className="text-xs text-muted leading-6">
          <div>
            Arm <span className="text-ink font-medium">{gate.servo.angle} deg</span>
          </div>
          <div>
            Lamp{" "}
            <span className={gate.led.green ? "text-emerald-300 font-medium" : "text-red-300 font-medium"}>
              {gate.led.green ? "GO" : "STOP"}
            </span>
          </div>
          <div>
            IR beam{" "}
            <span className={gate.ir.blocked ? "text-red-300 font-medium" : "text-ink font-medium"}>
              {gate.ir.blocked ? "blocked" : "clear"}
            </span>
          </div>
          <div>
            Buzzer <span className={gate.buzzer ? "text-purple-300 font-medium" : "text-ink font-medium"}>{gate.buzzer ? "on" : "off"}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-line">
        <button
          onClick={() => send({ type: "vehicle", present: !world.gate.vehicleWaiting })}
          className={`text-xs font-medium rounded-md px-3 py-1.5 transition-colors ${
            world.gate.vehicleWaiting ? "bg-red-500/15 text-red-200 hover:bg-red-500/25" : "bg-surface2 text-ink hover:bg-line"
          }`}
        >
          {world.gate.vehicleWaiting ? "Remove car from the barrier" : "Send a car to the barrier"}
        </button>
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-sky-400"
            checked={world.gate.autoQueue}
            onChange={(e) => send({ type: "autoQueue", enabled: e.target.checked })}
          />
          Next car queues up automatically
        </label>
      </div>
    </div>
  );
}
