import { Car, DoorOpen, Radio, Cpu, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";

import { useEventsSocket } from "../hooks/useEventsSocket";

const CATEGORY_META = {
  booking: { label: "BOOKING", icon: Car, className: "text-sky-300 bg-sky-500/10 border-sky-900/40" },
  gate: { label: "GATE", icon: DoorOpen, className: "text-violet-300 bg-violet-500/10 border-violet-900/40" },
  sensor: { label: "SENSOR", icon: Radio, className: "text-amber-300 bg-amber-500/10 border-amber-900/40" },
  hardware: { label: "HARDWARE", icon: Cpu, className: "text-teal-300 bg-teal-500/10 border-teal-900/40" },
};

function CategoryBadge({ category }) {
  const meta = CATEGORY_META[category] || {
    label: category?.toUpperCase() || "SYSTEM",
    icon: Terminal,
    className: "text-muted bg-surface2 border-line",
  };
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${meta.className}`}
    >
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

export default function LogsFeed({ compact = false }) {
  const { events, connected } = useEventsSocket();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  return (
    <div className={`bg-surface rounded-xl border border-line flex flex-col ${compact ? "" : "h-full"}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <h2 className="font-semibold text-ink flex items-center gap-2">
          <Terminal size={16} className="text-accent" />
          System Activity Log
        </h2>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-400" : "text-muted"}`}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-line"}`} />
          {connected ? "Live" : "Connecting..."}
        </span>
      </div>

      <div className={`overflow-y-auto px-4 py-3 flex flex-col gap-2 ${compact ? "max-h-72" : "flex-1 min-h-0"}`}>
        {events.length === 0 && (
          <p className="text-sm text-muted py-6 text-center">
            No activity yet - book a slot, scan a QR, or let the sensor simulator run for a bit.
          </p>
        )}
        {events.map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 text-sm animate-fade-in">
            <span className="font-mono text-[11px] text-muted/70 pt-0.5 shrink-0 w-[68px]">
              {new Date(entry.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <CategoryBadge category={entry.category} />
            <span className="text-ink/90">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
