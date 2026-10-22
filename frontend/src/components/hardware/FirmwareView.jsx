import { useEffect, useState } from "react";

import { LAB_URL } from "../../api/client";

const KEYWORDS =
  /\b(void|static|const|struct|enum|if|else|for|while|switch|case|break|return|continue|true|false|bool|char|float|int|long|unsigned|uint8_t|uint16_t|HIGH|LOW|INPUT|OUTPUT|NULL|sizeof|define|ifndef|endif|include)\b/g;

// Tiny C/C++ highlighter -- enough to make the sketch readable, no dependency.
function highlight(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
    return <span className="text-muted italic">{line}</span>;
  }
  const commentAt = line.indexOf("//");
  const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : "";

  const parts = [];
  let last = 0;
  const token = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?[fFuUlL]*\b|\b[A-Za-z_]\w*\b|#\w+)/g;
  let match;
  while ((match = token.exec(code)) !== null) {
    if (match.index > last) parts.push(code.slice(last, match.index));
    const text = match[0];
    let className = null;
    if (text.startsWith('"') || text.startsWith("'")) className = "text-emerald-300";
    else if (/^\d/.test(text)) className = "text-amber-300";
    else if (text.startsWith("#")) className = "text-fuchsia-300";
    else if (text.match(KEYWORDS) && text.match(KEYWORDS)[0] === text) className = "text-sky-300";
    else if (/^[A-Z][A-Z0-9_]{2,}$/.test(text)) className = "text-teal-300";
    parts.push(className ? <span key={match.index} className={className}>{text}</span> : text);
    last = match.index + text.length;
  }
  if (last < code.length) parts.push(code.slice(last));
  if (comment) parts.push(<span key="c" className="text-muted italic">{comment}</span>);
  return parts;
}

const FILES = [
  { name: "zone_node.ino", label: "Zone controller (x5)", note: "4 bays: HC-SR04 + LED each" },
  { name: "gate_node.ino", label: "Gate controller", note: "servo, IR beam, LCD, buzzer" },
];

const FRAMES = [
  ["B,<node>,<fw>,<first>,<n>", "node to gateway", "boot banner (also asks the gateway to re-send LED states)"],
  ["H,<node>,<uptime_s>", "node to gateway", "heartbeat every 15 s"],
  ["S,<slot>,<0|1>,<cm>", "node to gateway", "bay report: occupied flag + filtered distance"],
  ["V,<0|1>", "gate to gateway", "vehicle present at the barrier"],
  ["A,<entry|exit>,<booking>,<slot>", "gate to gateway", "barrier cycle finished"],
  ["L,<slot>,<f|b|o>", "gateway to zone", "LED state decided by the backend"],
  ["G,<entry|exit>,<booking>,<slot>", "gateway to gate", "open the barrier"],
  ["D,<reason>", "gateway to gate", "reject (shown on the LCD, buzzer x3)"],
  ["F,<free>,<total>", "gateway to gate", "free-slot count for the LCD"],
];

export default function FirmwareView() {
  const [active, setActive] = useState(FILES[0].name);
  const [sources, setSources] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (sources[active]) return;
    let cancelled = false;
    fetch(`${LAB_URL}/firmware/${active}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setSources((prev) => ({ ...prev, [active]: text }));
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [active, sources]);

  const source = sources[active];

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="bg-surface border border-line rounded-xl overflow-hidden min-w-0">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
          {FILES.map((file) => (
            <button
              key={file.name}
              onClick={() => setActive(file.name)}
              className={`text-xs font-medium rounded-md px-2.5 py-1 transition-colors ${
                active === file.name ? "bg-surface2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {file.name}
            </button>
          ))}
          <span className="text-[11px] text-muted ml-auto">
            {FILES.find((f) => f.name === active)?.label} - compiled with avr-gcc 7.3 to a 32 KB flash image
          </span>
        </div>
        <div className="overflow-auto max-h-[640px] font-mono text-[12px] leading-5 py-2">
          {error && <div className="px-4 text-red-300">Could not load the sketch: {error}</div>}
          {!source && !error && <div className="px-4 text-muted">Loading...</div>}
          {source &&
            source.split("\n").map((line, i) => (
              <div key={i} className="flex hover:bg-surface2/60">
                <span className="select-none text-right text-muted/50 w-10 shrink-0 pr-3">{i + 1}</span>
                <span className="whitespace-pre text-ink/90">{highlight(line)}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <div className="bg-surface border border-line rounded-xl p-4">
          <h3 className="font-semibold text-ink text-sm mb-1">How the pieces talk</h3>
          <p className="text-xs text-muted leading-relaxed mb-3">
            Each Arduino Uno is wired to the Raspberry Pi gateway by a serial link. The gateway
            (gateway/pi_gateway.py) turns these compact frames into MQTT JSON for the backend, and back.
          </p>
          <div className="flex flex-col gap-2">
            {FRAMES.map(([frame, direction, meaning]) => (
              <div key={frame} className="text-xs">
                <code className="text-sky-300">{frame}</code>
                <div className="text-muted">
                  <span className="text-ink/80">{direction}</span> - {meaning}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface border border-line rounded-xl p-4 text-xs text-muted leading-relaxed">
          <h3 className="font-semibold text-ink text-sm mb-1">Change the firmware</h3>
          Edit a sketch under <code className="text-ink/90">firmware/</code>, then run{" "}
          <code className="text-ink/90">firmware/build.sh</code> (compiles in Docker) and{" "}
          <code className="text-ink/90">docker compose restart hardware-lab</code>. The same .hex files can be
          flashed to real Arduino Uno boards unchanged.
        </div>
      </div>
    </div>
  );
}
