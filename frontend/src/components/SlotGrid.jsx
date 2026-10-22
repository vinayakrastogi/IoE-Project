import SlotCell from "./SlotCell";

export default function SlotGrid({ slots, onSlotClick, connected }) {
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-ink">Live Slot Map</h2>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${
            connected ? "text-emerald-400" : "text-muted"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-line"}`}
          />
          {connected ? "Live" : "Connecting..."}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {slots.map((slot) => (
          <SlotCell key={slot.id} slot={slot} onClick={onSlotClick} />
        ))}
      </div>

      <div className="flex gap-4 mt-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slot-free" /> Free
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slot-booked" /> Booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slot-occupied" /> Occupied
        </span>
      </div>
    </div>
  );
}
