import { useState } from "react";

function toLocalInputValue(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

const inputClass =
  "w-full bg-bg border border-line rounded-md px-3 py-2 text-sm mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-accent/60";

export default function BookingModal({ slot, onClose, onConfirm }) {
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  const [startTime, setStartTime] = useState(toLocalInputValue(now));
  const [endTime, setEndTime] = useState(toLocalInputValue(inHour));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setError(null);
    if (new Date(endTime) <= new Date(startTime)) {
      setError("End time must be after start time");
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm({
        slot_id: slot.id,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
      });
    } catch (err) {
      setError(err.response?.data?.detail || "Booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-surface border border-line rounded-xl p-6 w-full max-w-sm shadow-glow animate-fade-in">
        <h3 className="font-semibold text-lg text-ink mb-1">Book Slot {slot.label}</h3>
        <p className="text-sm text-muted mb-4">{slot.location}</p>

        <label className="block text-xs font-medium text-muted mb-1">Start time</label>
        <input
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className={inputClass}
        />

        <label className="block text-xs font-medium text-muted mb-1">End time</label>
        <input
          type="datetime-local"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className={inputClass}
        />

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <div className="flex gap-2 mt-2">
          <button
            onClick={onClose}
            className="flex-1 border border-line rounded-md py-2 text-sm font-medium text-muted hover:bg-surface2 hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 bg-accent hover:bg-sky-400 disabled:opacity-50 text-bg rounded-md py-2 text-sm font-semibold transition-colors"
          >
            {submitting ? "Booking..." : "Confirm Booking"}
          </button>
        </div>
      </div>
    </div>
  );
}
