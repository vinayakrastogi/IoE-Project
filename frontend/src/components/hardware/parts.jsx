// Building blocks for the circuit diagrams on the Hardware Lab page: Wokwi's
// open-source web components (the same parts the Wokwi simulator draws), a
// fixed-size "stage" that scales to the container, and SVG wires.

import "@wokwi/elements";
import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";

// Natural size (px) of each element, as laid out in the browser. Needed to
// work out where a pin ends up when a part is turned upside down.
export const PART_SIZE = {
  "wokwi-arduino-uno": [274.3, 208.1],
  "wokwi-hc-sr04": [170.1, 101],
  "wokwi-rgb-led": [42.1, 79.1],
  "wokwi-led": [40, 50],
  "wokwi-servo": [170.1, 126],
  "wokwi-lcd1602": [302.4, 142.6],
  "wokwi-buzzer": [75, 83.6],
  "wokwi-resistor": [59.1, 11.3],
};

const pinCache = new Map();

function pinTable(tag, props) {
  const key = `${tag}:${JSON.stringify(props ?? {})}`;
  if (!pinCache.has(key)) {
    const probe = document.createElement(tag);
    Object.assign(probe, props ?? {});
    pinCache.set(key, Object.fromEntries((probe.pinInfo ?? []).map((pin) => [pin.name, pin])));
  }
  return pinCache.get(key);
}

/**
 * Absolute stage position of pin `name` on a part whose (unrotated) box has its
 * top-left corner at (x, y). `rotate` is in degrees (multiples of 90) about the
 * centre of the box, the same way CSS `transform: rotate()` turns the element.
 */
export function pinPos(tag, name, { x = 0, y = 0, rotate = 0, props } = {}) {
  const pin = pinTable(tag, props)[name];
  if (!pin) throw new Error(`${tag} has no pin "${name}"`);
  const [w, h] = PART_SIZE[tag];
  const dx = pin.x - w / 2;
  const dy = pin.y - h / 2;
  const radians = (rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians));
  const sin = Math.round(Math.sin(radians));
  return { x: x + w / 2 + dx * cos - dy * sin, y: y + h / 2 + dx * sin + dy * cos };
}

/** A Wokwi web component: absolutely positioned on a stage, or `inline` in normal flow. */
export function Part({ tag, x, y, rotate = 0, props = {}, title, style, inline = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [key, value] of Object.entries(props)) {
      if (el[key] !== value) el[key] = value;
    }
  });

  return createElement(tag, {
    ref,
    title,
    style: inline
      ? { display: "block", ...style }
      : {
          position: "absolute",
          display: "block",
          left: x,
          top: y,
          transform: rotate ? `rotate(${rotate}deg)` : undefined,
          ...style,
        },
  });
}

/** Fixed-size drawing surface that shrinks to fit its container. */
export function Stage({ width, height, children }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setScale(Math.min(1.2, el.clientWidth / width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: height * scale }}>
      <div
        className="absolute left-0 top-0"
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

/** Point at parameter t (0..1) on the S-curve that <Wires> draws between a and b. */
export function curvePoint(a, b, t) {
  const mid = (a.y + b.y) / 2;
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * b.y,
  };
}

function curvePath(a, b) {
  const mid = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} C ${a.x} ${mid} ${b.x} ${mid} ${b.x} ${b.y}`;
}

function polylinePath(points, radius = 12) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const here = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(here.x - prev.x, here.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - here.x, next.y - here.y) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: here.x - ((here.x - prev.x) / inLen) * r, y: here.y - ((here.y - prev.y) / inLen) * r };
    const b = { x: here.x + ((next.x - here.x) / outLen) * r, y: here.y + ((next.y - here.y) / outLen) * r };
    d += ` L ${a.x} ${a.y} Q ${here.x} ${here.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/**
 * wires: [{ points: [{x, y}, ...], color, width?, opacity?, active? }]
 * Two points draw a smooth S-curve; more points draw a routed polyline.
 */
export function Wires({ width, height, wires }) {
  return (
    <svg
      className="absolute left-0 top-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
    >
      {wires.map((wire, index) => {
        const { points, color, width: strokeWidth = 2.4, opacity = 0.95, active = false } = wire;
        const d = points.length === 2 ? curvePath(points[0], points[1]) : polylinePath(points);
        const ends = [points[0], points[points.length - 1]];
        return (
          <g key={index} opacity={opacity}>
            <path d={d} stroke="#05070d" strokeWidth={strokeWidth + 2.4} strokeLinecap="round" opacity="0.55" />
            <path
              d={d}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              style={active ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined}
            />
            {ends.map((end, i) => (
              <circle key={i} cx={end.x} cy={end.y} r={strokeWidth * 0.9} fill={color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** A 220-ohm style resistor glyph drawn at a point on a wire. */
export function ResistorGlyph({ x, y, label = "220" }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-14" y="-6" width="28" height="12" rx="3" fill="#d5b597" stroke="#05070d" strokeWidth="1" />
      <text x="0" y="3.2" textAnchor="middle" fontSize="8" fontFamily="ui-monospace, monospace" fill="#3a2a1a" fontWeight="700">
        {label}
      </text>
    </g>
  );
}

/** Ground symbol hanging off (x, y); dir = 1 points down, -1 points up. */
export function GroundGlyph({ x, y, dir = 1, color = "#8b96ab" }) {
  return (
    <g transform={`translate(${x} ${y}) scale(1 ${dir})`} stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <line x1="0" y1="0" x2="0" y2="6" />
      <line x1="-7" y1="6" x2="7" y2="6" />
      <line x1="-4.5" y1="10" x2="4.5" y2="10" />
      <line x1="-2" y1="14" x2="2" y2="14" />
    </g>
  );
}

/** Supply flag ("5V") hanging off (x, y); dir = 1 points down, -1 points up. */
export function SupplyGlyph({ x, y, label = "5V", dir = 1, color = "#f87171", anchor = "middle" }) {
  const textY = dir === 1 ? y + 19 : y - 12;
  return (
    <g stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <line x1={x} y1={y} x2={x} y2={y + dir * 9} />
      <line x1={x - 5} y1={y + dir * 9} x2={x + 5} y2={y + dir * 9} />
      <text
        x={x}
        y={textY}
        fill={color}
        stroke="none"
        fontSize="10"
        fontWeight="600"
        textAnchor={anchor}
        fontFamily="ui-monospace, monospace"
        style={{ paintOrder: "stroke", stroke: "#0e1420", strokeWidth: 3.5, strokeLinejoin: "round" }}
      >
        {label}
      </text>
    </g>
  );
}

/** A short wire from a power pin straight down to a ground / supply symbol. */
export function PowerStub({ x, y, depth = 10, kind = "gnd", label = "5V", anchor = "middle", dir = 1 }) {
  const color = kind === "gnd" ? "#8b96ab" : "#f87171";
  const end = y + dir * depth;
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={end} stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {kind === "gnd" ? (
        <GroundGlyph x={x} y={end} dir={dir} />
      ) : (
        <SupplyGlyph x={x} y={end} dir={dir} label={label} anchor={anchor} />
      )}
    </g>
  );
}
