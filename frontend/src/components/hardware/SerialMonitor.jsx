import { useEffect, useRef } from "react";

// Plain-English reading of the line protocol, so the traffic is self-explanatory
// during a demo. The frame formats are documented in firmware/zone_node and
// gateway/pi_gateway.py.
export function gloss(line) {
  if (line.startsWith("#")) return "firmware log";
  const f = line.split(",");
  switch (f[0]) {
    case "S":
      return `sensor report: slot ${f[1]} ${f[2] === "1" ? "occupied" : "free"}, gap ${f[3]} cm`;
    case "L":
      return `LED command: slot ${f[1]} is ${{ f: "free", b: "booked", o: "occupied" }[f[2]] ?? f[2]}`;
    case "G":
      return `open barrier: ${f[1]}, booking ${f[2]}, slot ${f[3]}`;
    case "D":
      return `reject: ${f.slice(1).join(",")}`;
    case "A":
      return `barrier cycle finished: ${f[1]}, booking ${f[2]}, slot ${f[3]}`;
    case "V":
      return f[1] === "1" ? "vehicle at the barrier" : "barrier lane clear";
    case "F":
      return `free-slot count ${f[1]} of ${f[2]}`;
    case "B":
      return `boot banner: ${f[1]}, firmware ${f[2]}`;
    case "H":
      return `heartbeat: up ${f[2]} s`;
    default:
      return "";
  }
}

const DIR_STYLE = {
  tx: { label: "TX", className: "text-sky-300" },
  rx: { label: "RX", className: "text-amber-300" },
  info: { label: "--", className: "text-muted" },
};

export default function SerialMonitor({ lines = [], title = "Serial monitor", height = 240 }) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line text-xs">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-muted">
          <span className="text-sky-300">TX</span> Arduino to gateway, <span className="text-amber-300">RX</span>{" "}
          gateway to Arduino, 115200 baud
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="overflow-y-auto font-mono text-[12px] leading-5 px-3 py-2"
        style={{ height }}
      >
        {lines.length === 0 && <div className="text-muted">No traffic yet.</div>}
        {lines.map((entry, i) => {
          const style = DIR_STYLE[entry.dir] ?? DIR_STYLE.info;
          return (
            <div key={`${entry.t}-${i}`} className="flex gap-2 whitespace-pre-wrap break-all">
              <span className="text-muted/60 shrink-0">{new Date(entry.t).toLocaleTimeString([], { hour12: false })}</span>
              <span className={`shrink-0 w-5 ${style.className}`}>{style.label}</span>
              <span className={entry.dir === "info" ? "text-muted" : "text-ink"}>{entry.line}</span>
              {entry.dir !== "info" && <span className="text-muted/70 hidden md:inline">{gloss(entry.line)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
