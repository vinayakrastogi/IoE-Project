import { useState } from "react";

/** What colour the bay's physical LED is showing, decoded from its two driven pins. */
export function ledState(led) {
  if (led.red && led.green) return { key: "yellow", label: "booked", dot: "bg-slot-booked shadow-glow-yellow" };
  if (led.red) return { key: "red", label: "occupied", dot: "bg-slot-occupied shadow-glow-red" };
  if (led.green) return { key: "green", label: "free", dot: "bg-slot-free shadow-glow-green" };
  return { key: "off", label: "off", dot: "bg-line" };
}

export function LedDot({ led, size = "h-3.5 w-3.5" }) {
  const state = ledState(led);
  return <span className={`inline-block rounded-full ${size} transition-all duration-200 ${state.dot}`} title={`LED ${state.label}`} />;
}

const MIN_CM = 5;
const MAX_CM = 300;

export default function BayControl({ bay, send, compact = false }) {
  const [draft, setDraft] = useState(null);
  const value = draft ?? Math.round(bay.worldCm);
  const state = ledState(bay.led);
  const gap = bay.measuredCm === null ? "..." : bay.measuredCm >= 399 ? "no echo" : `${bay.measuredCm.toFixed(1)} cm`;

  return (
    <div className="bg-surface border border-line rounded-xl p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LedDot led={bay.led} />
          <span className="font-bold text-ink">{bay.label}</span>
          <span className="text-[11px] text-muted">slot {bay.slot}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted">{state.label}</span>
      </div>

      <div className="text-xs text-muted leading-relaxed">
        <div>
          Firmware sees <span className="text-ink font-medium">{gap}</span>
          {bay.occupied !== null && (
            <span className={bay.occupied ? "text-red-300" : "text-emerald-300"}> - {bay.occupied ? "occupied" : "free"}</span>
          )}
        </div>
        {!compact && <div className="text-[11px] opacity-70">controller {bay.node}</div>}
      </div>

      <div>
        <input
          type="range"
          min={MIN_CM}
          max={MAX_CM}
          value={value}
          onChange={(e) => {
            const cm = Number(e.target.value);
            setDraft(cm);
            send({ type: "distance", slot: bay.slot, cm });
          }}
          onPointerUp={() => setDraft(null)}
          onBlur={() => setDraft(null)}
          className="w-full accent-sky-400"
          aria-label={`Distance in front of the sensor for bay ${bay.label}`}
        />
        <div className="flex justify-between text-[10px] text-muted/80 -mt-0.5">
          <span>{MIN_CM} cm</span>
          <span className="text-ink/80">{value} cm</span>
          <span>{MAX_CM} cm</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => send({ type: "park", slot: bay.slot })}
          className="text-xs font-medium bg-surface2 hover:bg-line text-ink rounded-md py-1.5 transition-colors"
        >
          Park car
        </button>
        <button
          onClick={() => send({ type: "leave", slot: bay.slot })}
          className="text-xs font-medium bg-surface2 hover:bg-line text-ink rounded-md py-1.5 transition-colors"
        >
          Remove car
        </button>
      </div>
    </div>
  );
}
