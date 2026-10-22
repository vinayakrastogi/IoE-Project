const STATUS_STYLES = {
  free: "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 hover:shadow-glow-green cursor-pointer",
  booked: "bg-yellow-400/15 border-yellow-400/60 text-yellow-300 shadow-glow-yellow",
  occupied: "bg-red-500/10 border-red-500/40 text-red-300",
};

export default function SlotCell({ slot, onClick }) {
  const clickable = slot.status === "free" && onClick;

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onClick(slot)}
      className={`aspect-square rounded-lg border flex flex-col items-center justify-center transition-all ${STATUS_STYLES[slot.status]} ${
        !clickable ? "cursor-default" : ""
      }`}
      title={`Slot ${slot.label} - ${slot.status}`}
    >
      <span className="font-bold text-sm">{slot.label}</span>
      <span className="text-[10px] uppercase tracking-wide opacity-80">{slot.status}</span>
    </button>
  );
}
