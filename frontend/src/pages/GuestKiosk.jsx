import { useState } from "react";

import { bookingsApi } from "../api/endpoints";
import Logo from "../components/Logo";
import QRDisplay from "../components/QRDisplay";
import { useSlotSocket } from "../hooks/useSlotSocket";

const inputClass =
  "w-full bg-bg border border-line rounded-md px-3 py-2 text-sm mb-4 text-ink focus:outline-none focus:ring-2 focus:ring-accent/60";

export default function GuestKiosk() {
  const { free, total } = useSlotSocket();
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [duration, setDuration] = useState(120);
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await bookingsApi.createGuest({
        guest_name: guestName,
        guest_phone: guestPhone,
        duration_minutes: Number(duration),
      });
      setBooking(result);
    } catch (err) {
      setError(err.response?.data?.detail || "No slots available right now");
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setBooking(null);
    setGuestName("");
    setGuestPhone("");
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-4">
          <Logo size={36} />
        </div>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-ink">Walk-in Booking</h1>
          <p className="text-sm text-muted mt-1">
            {free}/{total} slots free right now - no account needed.
          </p>
        </div>

        {booking ? (
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <QRDisplay booking={booking} />
            <button onClick={startOver} className="text-sm text-muted hover:text-ink transition-colors">
              Book another slot
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-surface rounded-xl border border-line p-6 animate-fade-in">
            <label className="block text-xs font-medium text-muted mb-1">Your name</label>
            <input
              required
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className={inputClass}
            />

            <label className="block text-xs font-medium text-muted mb-1">Phone number</label>
            <input
              required
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              className={inputClass}
            />

            <label className="block text-xs font-medium text-muted mb-1">Expected duration</label>
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className={inputClass}>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
              <option value={240}>4 hours</option>
              <option value={480}>8 hours</option>
            </select>

            {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

            <button
              type="submit"
              disabled={submitting || free === 0}
              className="w-full bg-accent hover:bg-sky-400 disabled:opacity-50 text-bg rounded-md py-2.5 text-sm font-semibold transition-colors"
            >
              {free === 0 ? "Lot Full" : submitting ? "Booking..." : "Book Now"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
